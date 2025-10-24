"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Cropper from "react-easy-crop";
import { api } from "@/utils/api";

interface Speaker {
  name: string;
  designation: string;
  company: string;
  linkedin: string;
  imageUrl: string;
  _id?: string;
}

interface Schedule {
  day: string;
  time: string;
  title: string;
  description: string;
  speakers: string[];
  _id?: string;
}

interface Partner {
  name: string;
  role: string;
  website: string;
  logoUrl: string;
  _id?: string;
}

interface RequiredProfileFields {
  institution: boolean;
  course: boolean;
  year: boolean;
}

interface TicketSettings {
  autoGenerate: boolean;
  sendEmail: boolean;
  manualApproval: boolean;
}

interface CustomField {
  label: string;
  type: "text" | "email" | "number" | "dropdown" | "checkbox" | "file";
  required: boolean;
  options: string[];
  autoFillFromProfile?: "institution" | "course" | "year";
}

interface EventForm {
  title: string;
  slug: string;
  description: string;
  category: string;
  venue: string;
  venueIframeLink: string; // Added this field
  organizer: string;
  maxAttendees: number;
  minAttendees?: number;
  price: number;
  theme: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  registrationLink: string;
  whatsappGroup: string;
  isFeatured: boolean;
  bannerUrl?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
}

export default function EditEventPage() {
  const router = useRouter();
  const { id } = useParams();
  
  const [form, setForm] = useState<EventForm>({
    title: "",
    slug: "",
    description: "",
    category: "General",
    venue: "",
    venueIframeLink: "", // Added this field
    organizer: "",
    maxAttendees: 100,
    minAttendees: 10,
    price: 0,
    theme: "Fire",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    registrationLink: "",
    whatsappGroup: "",
    isFeatured: false,
    bannerUrl: "",
  });

  const [ticketSettings, setTicketSettings] = useState<TicketSettings>({
    autoGenerate: false,
    sendEmail: true,
    manualApproval: false,
  });

  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [benefits, setBenefits] = useState<string[]>([""]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [requiredProfileFields, setRequiredProfileFields] = useState<RequiredProfileFields>({
    institution: false,
    course: false,
    year: false,
  });
  
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeSection, setActiveSection] = useState("basic");
  const [useManualLocation, setUseManualLocation] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Load Google Maps script
  useEffect(() => {
    const loadGoogleMaps = () => {
      if ((window as any).google && (window as any).google.maps) {
        setMapLoaded(true);
        return;
      }

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        setMapLoaded(true);
      };
      document.head.appendChild(script);
    };

    loadGoogleMaps();
  }, []);

  // Generate slug from title
  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]+/g, "");
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!form.title.trim()) newErrors.title = "Event title is required";
    if (!form.slug.trim()) newErrors.slug = "Slug is required";
    if (!form.description.trim()) newErrors.description = "Description is required";
    if (!form.venue.trim()) newErrors.venue = "Venue is required";
    if (!form.startDate) newErrors.startDate = "Start date is required";
    if (!form.endDate) newErrors.endDate = "End date is required";
    if (!form.startTime) newErrors.startTime = "Start time is required";
    if (!form.endTime) newErrors.endTime = "End time is required";
    
    if (form.maxAttendees < 1) newErrors.maxAttendees = "Max attendees must be at least 1";
    if (form.minAttendees && form.minAttendees < 1) newErrors.minAttendees = "Min attendees must be at least 1";
    if (form.minAttendees && form.maxAttendees && form.minAttendees > form.maxAttendees) {
      newErrors.minAttendees = "Min attendees cannot exceed max attendees";
    }
    
    if (form.price < 0) newErrors.price = "Price cannot be negative";

    // Validate date logic
    if (form.startDate && form.endDate) {
      const start = new Date(`${form.startDate}T${form.startTime}`);
      const end = new Date(`${form.endDate}T${form.endTime}`);
      if (end <= start) newErrors.endDate = "End date/time must be after start date/time";
    }

    // Validate custom fields
    customFields.forEach((field, index) => {
      if (!field.label.trim()) {
        newErrors[`customField_${index}`] = "Field label is required";
      }
      if ((field.type === 'dropdown' || field.type === 'checkbox') && field.options.length === 0) {
        newErrors[`customField_options_${index}`] = "At least one option is required for dropdown/checkbox";
      }
      // Validate that options aren't empty strings
      if (field.type === 'dropdown' || field.type === 'checkbox') {
        field.options.forEach((option, optionIndex) => {
          if (!option.trim()) {
            newErrors[`customField_option_${index}_${optionIndex}`] = "Option cannot be empty";
          }
        });
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Fetch event data
  useEffect(() => {
    if (!id) return;
    
    const fetchEvent = async () => {
      try {
        setLoading(true);
        const res = await api.get(`/events/${id}`);
        
        if (res.data?.success) {
          const event = res.data.event;
          
          // Parse dates from ISO string to separate date and time
          const startDate = new Date(event.startDate);
          const endDate = new Date(event.endDate);
          
          setForm({
            title: event.title || "",
            slug: event.slug || "",
            description: event.description || "",
            category: event.category || "General",
            venue: event.venue || "",
            venueIframeLink: event.venueIframeLink || "", // Added this field
            organizer: event.organizer || "",
            maxAttendees: event.maxAttendees || 100,
            minAttendees: event.minAttendees || 10,
            price: event.price || 0,
            theme: event.theme || "Fire",
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            startTime: event.startTime || startDate.toTimeString().slice(0, 5),
            endTime: event.endTime || endDate.toTimeString().slice(0, 5),
            registrationLink: event.registrationLink || "",
            whatsappGroup: event.whatsappGroup || "",
            isFeatured: event.isFeatured || false,
            bannerUrl: event.bannerUrl || "",
            latitude: event.latitude,
            longitude: event.longitude,
            address: event.address,
          });

          setTicketSettings(event.ticketSettings || {
            autoGenerate: false,
            sendEmail: true,
            manualApproval: false,
          });

          setSpeakers(event.speakers || []);
          setSchedule(event.schedule || []);
          setBenefits(event.benefits && event.benefits.length > 0 ? event.benefits : [""]);
          setPartners(event.partners || []);
          setCustomFields(event.registrationForm || []);
          setRequiredProfileFields(event.requiredProfileFields || {
            institution: false,
            course: false,
            year: false,
          });

          // Set location mode based on whether coordinates exist
          if (event.latitude && event.longitude) {
            setUseManualLocation(false);
          } else {
            setUseManualLocation(true);
          }
        } else {
          setError(res.data?.message || "Failed to load event");
        }
      } catch (err: any) {
        console.error("fetchEvent error:", err);
        setError(err.response?.data?.message || "Failed to fetch event");
      } finally {
        setLoading(false);
      }
    };

    fetchEvent();
  }, [id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    
    if (type === "checkbox") {
      const checked = (e.target as HTMLInputElement).checked;
      setForm(prev => ({ ...prev, [name]: checked }));
    } else {
      setForm(prev => ({ ...prev, [name]: value }));
      
      // Auto-generate slug when title changes
      if (name === "title" && !form.slug) {
        setForm(prev => ({ ...prev, slug: generateSlug(value) }));
      }
    }
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: "" }));
    }
  };

  const handleTicketSettingsChange = (field: keyof TicketSettings, value: boolean) => {
    setTicketSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleProfileFieldChange = (field: keyof RequiredProfileFields) => {
    setRequiredProfileFields(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  // Speakers Management
  const addSpeaker = () => setSpeakers([...speakers, { name: "", designation: "", company: "", linkedin: "", imageUrl: "" }]);
  const removeSpeaker = (index: number) => setSpeakers(speakers.filter((_, i) => i !== index));
  const handleSpeakerChange = (index: number, field: keyof Speaker, value: string) => {
    const updated = [...speakers];
    updated[index][field] = value;
    setSpeakers(updated);
  };

  // Schedule Management
  const addSchedule = () => setSchedule([...schedule, { day: "", time: "", title: "", description: "", speakers: [] }]);
  const removeSchedule = (index: number) => setSchedule(schedule.filter((_, i) => i !== index));
  const handleScheduleChange = (index: number, field: Exclude<keyof Schedule, 'speakers'>, value: string) => {
    const updated = [...schedule];
    updated[index][field] = value;
    setSchedule(updated);
  };

  // Benefits Management
  const addBenefit = () => setBenefits([...benefits, ""]);
  const removeBenefit = (index: number) => setBenefits(benefits.filter((_, i) => i !== index));
  const handleBenefitChange = (index: number, value: string) => {
    const updated = [...benefits];
    updated[index] = value;
    setBenefits(updated);
  };

  // Partners Management
  const addPartner = () => setPartners([...partners, { name: "", role: "", website: "", logoUrl: "" }]);
  const removePartner = (index: number) => setPartners(partners.filter((_, i) => i !== index));
  const handlePartnerChange = (index: number, field: keyof Partner, value: string) => {
    const updated = [...partners];
    updated[index][field] = value;
    setPartners(updated);
  };

  // Custom Fields Management
  const addCustomField = () => setCustomFields([...customFields, { label: "", type: "text", required: false, options: [] }]);
  const removeCustomField = (index: number) => setCustomFields(customFields.filter((_, i) => i !== index));
  const handleCustomFieldChange = (index: number, field: keyof CustomField, value: string | boolean | string[] | undefined) => {
    setCustomFields(prev =>
      prev.map((f, i) =>
        i === index ? ({ ...f, [field]: value } as CustomField) : f
      )
    );
  };
  const addCustomFieldOption = (index: number) => {
    const updated = [...customFields];
    updated[index].options.push("");
    setCustomFields(updated);
  };
  const removeCustomFieldOption = (fieldIndex: number, optionIndex: number) => {
    const updated = [...customFields];
    updated[fieldIndex].options.splice(optionIndex, 1);
    setCustomFields(updated);
  };
  const handleCustomFieldOptionChange = (fieldIndex: number, optionIndex: number, value: string) => {
    const updated = [...customFields];
    updated[fieldIndex].options[optionIndex] = value;
    setCustomFields(updated);
  };

  const handlePosterSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setErrors(prev => ({ ...prev, poster: "Image must be less than 5MB" }));
        return;
      }
      if (!file.type.startsWith('image/')) {
        setErrors(prev => ({ ...prev, poster: "Please select an image file" }));
        return;
      }
      setPosterFile(file);
      setErrors(prev => ({ ...prev, poster: "" }));
    }
  };

  const onCropComplete = (_: any, croppedAreaPx: any) => setCroppedAreaPixels(croppedAreaPx);

 const uploadCroppedPoster = async (): Promise<string | null> => {
  if (!posterFile) return form.bannerUrl || null;

  try {
    let imageBlob: Blob;

    if (!croppedAreaPixels) {
      imageBlob = posterFile;
    } else {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const image = new Image();

      const objectUrl = URL.createObjectURL(posterFile);
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Failed to load image for cropping"));
        image.src = objectUrl;
      });

      // ensure valid context
      if (!ctx) throw new Error("Canvas 2D context not available");

      canvas.width = Math.max(1, Math.floor(croppedAreaPixels.width));
      canvas.height = Math.max(1, Math.floor(croppedAreaPixels.height));

      ctx.drawImage(
        image,
        Math.floor(croppedAreaPixels.x),
        Math.floor(croppedAreaPixels.y),
        Math.floor(croppedAreaPixels.width),
        Math.floor(croppedAreaPixels.height),
        0,
        0,
        Math.floor(croppedAreaPixels.width),
        Math.floor(croppedAreaPixels.height)
      );

      // free the object URL
      URL.revokeObjectURL(objectUrl);

      imageBlob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => resolve(blob! as Blob), "image/jpeg", 0.9)
      );
    }

    const formData = new FormData();
    // filename helps some servers / middlewares
    formData.append("file", imageBlob as Blob, "poster.jpg");

    // use `id` from useParams() — you already defined `const { id } = useParams();`
    const res = await api.post(`/upload/${id}`, formData); // <-- no manual Content-Type header

    // robust extraction of URL from different possible backend shapes
    const uploadedUrl =
      res?.data?.imageUrl ||
      res?.data?.filePath ||
      res?.data?.url ||
      res?.data?.data?.url ||
      null;

    if (!uploadedUrl) {
      console.error("Unexpected upload response:", res?.data);
      throw new Error("Upload succeeded but no URL returned");
    }

    console.log("Upload successful:", uploadedUrl);
    return uploadedUrl;
  } catch (error: any) {
    console.error("Upload error:", error?.response?.data || error.message || error);
    setErrors(prev => ({ ...prev, poster: "Failed to upload image" }));
    return form.bannerUrl || null;
  }
};


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      setActiveSection("basic");
      return;
    }

    setSaving(true);
    setErrors({});

    try {
      // Combine date and time for backend
      const startDateTime = new Date(`${form.startDate}T${form.startTime}`).toISOString();
      const endDateTime = new Date(`${form.endDate}T${form.endTime}`).toISOString();

      const bannerUrl = await uploadCroppedPoster();
      
      // Filter out empty benefits
      const filteredBenefits = benefits.filter(benefit => benefit.trim() !== "");
      
      const payload = {
        ...form,
        startDate: startDateTime,
        endDate: endDateTime,
        bannerUrl,
        ticketSettings,
        speakers,
        schedule,
        benefits: filteredBenefits,
        partners,
        requiredProfileFields,
        registrationForm: customFields,
      };

      const res = await api.put(`/events/${id}`, payload);
      
      if (res.data?.success) {
        router.push(`/admin/events/edit/${id}?updated=true`);
      } else {
        setError(res.data?.message || "Error updating event");
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to update event");
    } finally {
      setSaving(false);
    }
  };

  const sections = [
    { id: "basic", name: "Basic Info" },
    { id: "datetime", name: "Date & Time" },
    { id: "location", name: "Location" },
    { id: "media", name: "Media" },
    { id: "registration", name: "Registration" },
    { id: "tickets", name: "Ticket Settings" },
    { id: "custom-form", name: "Custom Form" },
    { id: "schedule", name: "Schedule" },
    { id: "speakers", name: "Speakers" },
    { id: "benefits", name: "Benefits" },
    { id: "partners", name: "Partners" },
    { id: "profile", name: "Profile Fields" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Error</h1>
          <p className="text-gray-600">{error}</p>
          <button
            onClick={() => router.back()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-green-600 to-blue-600 text-white">
            <h1 className="text-2xl font-bold">Edit Event</h1>
            <p className="text-green-100 mt-1">Update your event details</p>
          </div>

          {error && (
            <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Progress Navigation */}
          <div className="border-b border-gray-200">
            <div className="px-6 py-4">
              <div className="flex overflow-x-auto space-x-1">
                {sections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeSection === section.id
                        ? "bg-blue-100 text-blue-700"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    {section.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6">
            {/* Basic Information */}
            {activeSection === "basic" && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <span className="w-2 h-2 bg-blue-600 rounded-full mr-2"></span>
                  Basic Information
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Event Title *
                    </label>
                    <input
                      name="title"
                      placeholder="Enter event title"
                      value={form.title}
                      onChange={handleChange}
                      className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.title ? 'border-red-500' : 'border-gray-300'
                      }`}
                      required
                    />
                    {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      URL Slug *
                    </label>
                    <input
                      name="slug"
                      placeholder="event-url-slug"
                      value={form.slug}
                      onChange={handleChange}
                      className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.slug ? 'border-red-500' : 'border-gray-300'
                      }`}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">Unique identifier for your event URL</p>
                    {errors.slug && <p className="text-red-500 text-xs mt-1">{errors.slug}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Category
                    </label>
                    <select
                      name="category"
                      value={form.category}
                      onChange={handleChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="General">General</option>
                      <option value="Technology">Technology</option>
                      <option value="Business">Business</option>
                      <option value="Education">Education</option>
                      <option value="Health">Health</option>
                      <option value="Entertainment">Entertainment</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Organizer
                    </label>
                    <input
                      name="organizer"
                      placeholder="Event organizer"
                      value={form.organizer}
                      onChange={handleChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div className="flex items-center space-x-4">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        name="isFeatured"
                        checked={form.isFeatured}
                        onChange={handleChange}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">Feature this event</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Event Description *
                  </label>
                  <textarea
                    name="description"
                    placeholder="Describe your event in detail..."
                    value={form.description}
                    onChange={handleChange}
                    rows={4}
                    className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                      errors.description ? 'border-red-500' : 'border-gray-300'
                    }`}
                    required
                  />
                  {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description}</p>}
                </div>
              </div>
            )}

            {/* Date & Time */}
            {activeSection === "datetime" && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <span className="w-2 h-2 bg-green-600 rounded-full mr-2"></span>
                  Date & Time
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Start Date *
                    </label>
                    <input
                      type="date"
                      name="startDate"
                      value={form.startDate}
                      onChange={handleChange}
                      className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.startDate ? 'border-red-500' : 'border-gray-300'
                      }`}
                      required
                    />
                    {errors.startDate && <p className="text-red-500 text-xs mt-1">{errors.startDate}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Start Time *
                    </label>
                    <input
                      type="time"
                      name="startTime"
                      value={form.startTime}
                      onChange={handleChange}
                      className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.startTime ? 'border-red-500' : 'border-gray-300'
                      }`}
                      required
                    />
                    {errors.startTime && <p className="text-red-500 text-xs mt-1">{errors.startTime}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End Date *
                    </label>
                    <input
                      type="date"
                      name="endDate"
                      value={form.endDate}
                      onChange={handleChange}
                      min={form.startDate}
                      className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.endDate ? 'border-red-500' : 'border-gray-300'
                      }`}
                      required
                    />
                    {errors.endDate && <p className="text-red-500 text-xs mt-1">{errors.endDate}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End Time *
                    </label>
                    <input
                      type="time"
                      name="endTime"
                      value={form.endTime}
                      onChange={handleChange}
                      className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.endTime ? 'border-red-500' : 'border-gray-300'
                      }`}
                      required
                    />
                    {errors.endTime && <p className="text-red-500 text-xs mt-1">{errors.endTime}</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Location */}
            {activeSection === "location" && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <span className="w-2 h-2 bg-red-600 rounded-full mr-2"></span>
                  Event Location
                </h2>
                
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={!useManualLocation}
                        onChange={() => setUseManualLocation(false)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">Use Google Maps</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={useManualLocation}
                        onChange={() => setUseManualLocation(true)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-gray-700">Enter manually</span>
                    </label>
                  </div>

                  {!useManualLocation ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Search Venue on Google Maps *
                        </label>
                        <input
                          id="venue-input"
                          placeholder="Search for venue..."
                          defaultValue={form.venue}
                          className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                            errors.venue ? 'border-red-500' : 'border-gray-300'
                          }`}
                        />
                        {!mapLoaded && (
                          <p className="text-xs text-yellow-600 mt-1">
                            Loading Google Maps...
                          </p>
                        )}
                        {form.address && (
                          <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                            <p className="text-sm text-green-800">
                              <strong>Selected:</strong> {form.venue}
                            </p>
                            <p className="text-sm text-green-700">{form.address}</p>
                            {form.latitude && form.longitude && (
                              <p className="text-xs text-green-600">
                                Coordinates: {form.latitude.toFixed(6)}, {form.longitude.toFixed(6)}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Venue Map Embed URL
                        </label>
                        <input
                          name="venueIframeLink"
                          placeholder="https://maps.google.com/embed?..."
                          value={form.venueIframeLink}
                          onChange={handleChange}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Optional: Add a Google Maps embed URL for interactive venue map
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Venue Name *
                        </label>
                        <input
                          name="venue"
                          placeholder="Enter venue name"
                          value={form.venue}
                          onChange={handleChange}
                          className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                            errors.venue ? 'border-red-500' : 'border-gray-300'
                          }`}
                          required
                        />
                        {errors.venue && <p className="text-red-500 text-xs mt-1">{errors.venue}</p>}
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Venue Map Embed URL
                        </label>
                        <input
                          name="venueIframeLink"
                          placeholder="https://maps.google.com/embed?..."
                          value={form.venueIframeLink}
                          onChange={handleChange}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Optional: Add a Google Maps embed URL for interactive venue map
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Media */}
            {activeSection === "media" && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <span className="w-2 h-2 bg-purple-600 rounded-full mr-2"></span>
                  Media & Theme
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Event Poster
                    </label>
                    
                    {/* Current Poster Preview */}
                    {form.bannerUrl && !posterFile && (
                      <div className="mb-4">
                        <p className="text-sm text-gray-600 mb-2">Current Poster:</p>
                        <img 
                          src={form.bannerUrl} 
                          alt="Current poster" 
                          className="w-full max-w-xs h-48 object-cover rounded-lg border"
                        />
                      </div>
                    )}
                    
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handlePosterSelect}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                    />
                    <p className="text-xs text-gray-500 mt-1">Leave empty to keep current poster</p>
                    {errors.poster && <p className="text-red-500 text-xs mt-1">{errors.poster}</p>}
                    
                    {posterFile && (
                      <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Crop Poster (16:9 ratio)
                        </label>
                        <div className="relative w-full h-64 bg-gray-100 rounded-lg overflow-hidden border">
                          <Cropper
                            image={URL.createObjectURL(posterFile)}
                            crop={crop}
                            zoom={zoom}
                            aspect={16 / 9}
                            onCropChange={setCrop}
                            onZoomChange={setZoom}
                            onCropComplete={onCropComplete}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-sm text-gray-600">Zoom: {Math.round(zoom * 100)}%</span>
                          <input
                            type="range"
                            min="1"
                            max="3"
                            step="0.1"
                            value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            className="w-32"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Event Theme
                    </label>
                    <select
                      name="theme"
                      value={form.theme}
                      onChange={handleChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="Fire">Fire</option>
                      <option value="Forest">Forest</option>
                      <option value="Ocean">Ocean</option>
                      <option value="Cosmic">Cosmic</option>
                      <option value="Sunset">Sunset</option>
                      <option value="Electric">Electric</option>
                      <option value="Golden">Golden</option>
                      <option value="Rose">Rose</option>
                      <option value="Dark">Dark</option>
                      <option value="Arctic">Arctic</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-2">
                      Choose a theme that matches your event's vibe and branding
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Registration Details */}
            {activeSection === "registration" && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <span className="w-2 h-2 bg-orange-600 rounded-full mr-2"></span>
                  Registration & Pricing
                </h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Max Attendees *
                    </label>
                    <input
                      type="number"
                      name="maxAttendees"
                      min="1"
                      value={form.maxAttendees}
                      onChange={handleChange}
                      className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.maxAttendees ? 'border-red-500' : 'border-gray-300'
                      }`}
                      required
                    />
                    {errors.maxAttendees && <p className="text-red-500 text-xs mt-1">{errors.maxAttendees}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Min Attendees
                    </label>
                    <input
                      type="number"
                      name="minAttendees"
                      min="1"
                      value={form.minAttendees || 10}
                      onChange={handleChange}
                      className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.minAttendees ? 'border-red-500' : 'border-gray-300'
                      }`}
                    />
                    {errors.minAttendees && <p className="text-red-500 text-xs mt-1">{errors.minAttendees}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Price (USD)
                    </label>
                    <input
                      type="number"
                      name="price"
                      min="0"
                      step="0.01"
                      value={form.price}
                      onChange={handleChange}
                      className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                        errors.price ? 'border-red-500' : 'border-gray-300'
                      }`}
                    />
                    <p className="text-xs text-gray-500 mt-1">Set to 0 for free event</p>
                    {errors.price && <p className="text-red-500 text-xs mt-1">{errors.price}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Registration Link
                    </label>
                    <input
                      type="url"
                      name="registrationLink"
                      placeholder="https://..."
                      value={form.registrationLink}
                      onChange={handleChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      WhatsApp Group Link
                    </label>
                    <input
                      type="url"
                      name="whatsappGroup"
                      placeholder="https://chat.whatsapp.com/..."
                      value={form.whatsappGroup}
                      onChange={handleChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Ticket Settings */}
            {activeSection === "tickets" && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <span className="w-2 h-2 bg-green-600 rounded-full mr-2"></span>
                  Ticket Generation Settings
                </h2>
                
                <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
                  <p className="text-sm text-blue-700 mb-4">
                    Configure how tickets are generated and distributed for this event
                  </p>
                  
                  <div className="space-y-4">
                    <label className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        checked={ticketSettings.autoGenerate}
                        onChange={(e) => handleTicketSettingsChange("autoGenerate", e.target.checked)}
                        className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-900">Auto-generate tickets on registration</span>
                        <p className="text-xs text-gray-600 mt-1">
                          Tickets will be automatically created when users register for the event
                        </p>
                      </div>
                    </label>
                    
                    <label className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        checked={ticketSettings.sendEmail}
                        onChange={(e) => handleTicketSettingsChange("sendEmail", e.target.checked)}
                        className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-900">Send tickets via email</span>
                        <p className="text-xs text-gray-600 mt-1">
                          Automatically email tickets with QR codes to registered users
                        </p>
                      </div>
                    </label>
                    
                    <label className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        checked={ticketSettings.manualApproval}
                        onChange={(e) => handleTicketSettingsChange("manualApproval", e.target.checked)}
                        className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-900">Require manual approval</span>
                        <p className="text-xs text-gray-600 mt-1">
                          Tickets will be created but require admin approval before being sent to users
                        </p>
                      </div>
                    </label>
                  </div>

                  {/* Workflow Explanation */}
                  <div className="mt-6 p-4 bg-white rounded-lg border border-gray-200">
                    <h4 className="text-sm font-semibold text-gray-900 mb-2">Current Workflow:</h4>
                    <div className="text-xs text-gray-600 space-y-1">
                      {ticketSettings.autoGenerate ? (
                        ticketSettings.manualApproval ? (
                          <>
                            <p>Registration → Ticket Created (Pending) → Admin Approval → Email Sent</p>
                            <p className="text-blue-600">Tickets require manual review before distribution</p>
                          </>
                        ) : ticketSettings.sendEmail ? (
                          <>
                            <p>Registration → Ticket Created → Email Sent Immediately</p>
                            <p className="text-green-600">Fully automated ticket distribution</p>
                          </>
                        ) : (
                          <>
                            <p>Registration → Ticket Created (No Email)</p>
                            <p className="text-yellow-600">Tickets created but not emailed automatically</p>
                          </>
                        )
                      ) : (
                        <>
                          <p>Registration → No Ticket Generated</p>
                          <p className="text-gray-600">Tickets must be generated manually by admin</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Custom Registration Form */}
            {activeSection === "custom-form" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                    <span className="w-2 h-2 bg-purple-600 rounded-full mr-2"></span>
                    Custom Registration Form Fields
                  </h2>
                  <button
                    type="button"
                    onClick={addCustomField}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-full text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                  >
                    + Add Field
                  </button>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-4">
                  <p className="text-sm text-gray-600">
                    Add custom fields to your registration form. These will be shown to users when they register for your event.
                  </p>
                </div>

                {customFields.map((field, index) => (
                  <div key={index} className="bg-white p-6 rounded-lg border border-gray-200 mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Field Label *
                        </label>
                        <input
                          placeholder="e.g., Company Name, Job Title, etc."
                          value={field.label}
                          onChange={(e) => handleCustomFieldChange(index, "label", e.target.value)}
                          className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                            errors[`customField_${index}`] ? 'border-red-500' : 'border-gray-300'
                          }`}
                        />
                        {errors[`customField_${index}`] && (
                          <p className="text-red-500 text-xs mt-1">{errors[`customField_${index}`]}</p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Field Type
                        </label>
                        <select
                          value={field.type}
                          onChange={(e) => handleCustomFieldChange(index, "type", e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="text">Text</option>
                          <option value="email">Email</option>
                          <option value="number">Number</option>
                          <option value="dropdown">Dropdown</option>
                          <option value="checkbox">Checkbox</option>
                          <option value="file">File Upload</option>
                        </select>
                      </div>

                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => handleCustomFieldChange(index, "required", e.target.checked)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="ml-2 text-sm text-gray-700">Required field</span>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Auto-fill from Profile
                        </label>
                        <select
                          value={field.autoFillFromProfile || ""}
                          onChange={(e) => handleCustomFieldChange(index, "autoFillFromProfile", e.target.value || undefined)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">None</option>
                          <option value="institution">Institution</option>
                          <option value="course">Course</option>
                          <option value="year">Year</option>
                        </select>
                      </div>
                    </div>

                    {/* Options for dropdown and checkbox fields */}
                    {(field.type === 'dropdown' || field.type === 'checkbox') && (
                      <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Options {field.type === 'dropdown' ? '(Dropdown)' : '(Checkbox)'} *
                        </label>
                        {field.options.map((option, optionIndex) => (
                          <div key={optionIndex} className="flex items-center space-x-2 mb-2">
                            <input
                              placeholder={`Option ${optionIndex + 1}`}
                              value={option}
                              onChange={(e) => handleCustomFieldOptionChange(index, optionIndex, e.target.value)}
                              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            {field.options.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeCustomFieldOption(index, optionIndex)}
                                className="text-red-600 hover:text-red-800 p-2"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                        {errors[`customField_options_${index}`] && (
                          <p className="text-red-500 text-xs mt-1 mb-2">{errors[`customField_options_${index}`]}</p>
                        )}
                        <button
                          type="button"
                          onClick={() => addCustomFieldOption(index)}
                          className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50"
                        >
                          + Add Option
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => removeCustomField(index)}
                      className="mt-4 text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      Remove Field
                    </button>
                  </div>
                ))}

                {customFields.length === 0 && (
                  <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                    <p className="text-gray-500">No custom fields added yet.</p>
                    <p className="text-sm text-gray-400 mt-1">Add fields to collect additional information from registrants.</p>
                  </div>
                )}
              </div>
            )}

            {/* Schedule */}
            {activeSection === "schedule" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                    <span className="w-2 h-2 bg-green-600 rounded-full mr-2"></span>
                    Event Schedule
                  </h2>
                  <button
                    type="button"
                    onClick={addSchedule}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-full text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                  >
                    + Add Schedule Item
                  </button>
                </div>

                {schedule.map((item, index) => (
                  <div key={index} className="bg-gray-50 p-4 rounded-lg mb-3 border border-gray-200">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Day</label>
                        <input
                          placeholder="e.g., Day 1, Monday"
                          value={item.day}
                          onChange={(e) => handleScheduleChange(index, "day", e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
                        <input
                          placeholder="e.g., 9:00 AM - 10:00 AM"
                          value={item.time}
                          onChange={(e) => handleScheduleChange(index, "time", e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                        <input
                          placeholder="Session title"
                          value={item.title}
                          onChange={(e) => handleScheduleChange(index, "title", e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                        <textarea
                          placeholder="Session description"
                          value={item.description}
                          onChange={(e) => handleScheduleChange(index, "description", e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                          rows={2}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSchedule(index)}
                      className="mt-2 text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Speakers */}
            {activeSection === "speakers" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                    <span className="w-2 h-2 bg-purple-600 rounded-full mr-2"></span>
                    Speakers
                  </h2>
                  <button
                    type="button"
                    onClick={addSpeaker}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-full text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                  >
                    + Add Speaker
                  </button>
                </div>

                {speakers.map((speaker, index) => (
                  <div key={index} className="bg-gray-50 p-4 rounded-lg mb-3 border border-gray-200">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input
                        placeholder="Speaker Name"
                        value={speaker.name}
                        onChange={(e) => handleSpeakerChange(index, "name", e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2 text-sm"
                      />
                      <input
                        placeholder="Designation"
                        value={speaker.designation}
                        onChange={(e) => handleSpeakerChange(index, "designation", e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2 text-sm"
                      />
                      <input
                        placeholder="Company"
                        value={speaker.company}
                        onChange={(e) => handleSpeakerChange(index, "company", e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2 text-sm"
                      />
                      <input
                        placeholder="LinkedIn URL"
                        value={speaker.linkedin}
                        onChange={(e) => handleSpeakerChange(index, "linkedin", e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2 text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSpeaker(index)}
                      className="mt-2 text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Benefits */}
            {activeSection === "benefits" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                    <span className="w-2 h-2 bg-yellow-600 rounded-full mr-2"></span>
                    Event Benefits
                  </h2>
                  <button
                    type="button"
                    onClick={addBenefit}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-full text-white bg-yellow-600 hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
                  >
                    + Add Benefit
                  </button>
                </div>

                {benefits.map((benefit, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <input
                      placeholder="What will attendees gain? (e.g., Networking opportunities, Skill development, etc.)"
                      value={benefit}
                      onChange={(e) => handleBenefitChange(index, e.target.value)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    {benefits.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeBenefit(index)}
                        className="text-red-600 hover:text-red-800 p-2"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Partners */}
            {activeSection === "partners" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                    <span className="w-2 h-2 bg-indigo-600 rounded-full mr-2"></span>
                    Event Partners
                  </h2>
                  <button
                    type="button"
                    onClick={addPartner}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-full text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    + Add Partner
                  </button>
                </div>

                {partners.map((partner, index) => (
                  <div key={index} className="bg-gray-50 p-4 rounded-lg mb-3 border border-gray-200">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input
                        placeholder="Partner Name"
                        value={partner.name}
                        onChange={(e) => handlePartnerChange(index, "name", e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2 text-sm"
                      />
                      <input
                        placeholder="Role (Sponsor, Organizer, etc.)"
                        value={partner.role}
                        onChange={(e) => handlePartnerChange(index, "role", e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2 text-sm"
                      />
                      <input
                        placeholder="Website URL"
                        value={partner.website}
                        onChange={(e) => handlePartnerChange(index, "website", e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2 text-sm"
                      />
                      <input
                        placeholder="Logo URL"
                        value={partner.logoUrl}
                        onChange={(e) => handlePartnerChange(index, "logoUrl", e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2 text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removePartner(index)}
                      className="mt-2 text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Profile Fields */}
            {activeSection === "profile" && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <span className="w-2 h-2 bg-blue-600 rounded-full mr-2"></span>
                  Required Profile Fields
                </h2>
                
                <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-600 mb-4">
                    Select which fields attendees must fill out during registration:
                  </p>
                  
                  <div className="space-y-3">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={requiredProfileFields.institution}
                        onChange={() => handleProfileFieldChange("institution")}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-3 text-sm text-gray-700">Institution/Organization</span>
                    </label>
                    
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={requiredProfileFields.course}
                        onChange={() => handleProfileFieldChange("course")}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-3 text-sm text-gray-700">Course/Program</span>
                    </label>
                    
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={requiredProfileFields.year}
                        onChange={() => handleProfileFieldChange("year")}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-3 text-sm text-gray-700">Academic Year</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Navigation and Submit */}
            <div className="flex justify-between pt-6 border-t border-gray-200 mt-8">
              <div className="flex space-x-3">
                {sections.findIndex(s => s.id === activeSection) > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const currentIndex = sections.findIndex(s => s.id === activeSection);
                      setActiveSection(sections[currentIndex - 1].id);
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    ← Previous
                  </button>
                )}
                {sections.findIndex(s => s.id === activeSection) < sections.length - 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const currentIndex = sections.findIndex(s => s.id === activeSection);
                      setActiveSection(sections[currentIndex + 1].id);
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Next →
                  </button>
                )}
              </div>

              {activeSection === sections[sections.length - 1].id && (
                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? (
                      <span className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Updating Event...
                      </span>
                    ) : (
                      "Update Event"
                    )}
                  </button>
                </div>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}