"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/utils/api";
import { getImageUrl, ImageWithFallback } from "@/utils/image";
import RegistrationForm from "@/components/RegistrationForm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Calendar, 
  MapPin, 
  Clock, 
  Users, 
  Ticket, 
  AlertCircle, 
  CheckCircle, 
  X,
  Download,
  QrCode,
  Copy,
  ArrowLeft,
  Share2,
  Bookmark,
  ExternalLink,
  User,
  Mic,
  Clock3,
  Star,
  Gift,
  Handshake,
  Globe,
  Crown,
  Building2,
  Mail,
  Phone,
  Info
} from "lucide-react";
import { toast } from "sonner";

interface RegistrationField {
  label: string;
  type: "text" | "email" | "number" | "dropdown" | "checkbox" | "file";
  required: boolean;
  options?: string[];
  autoFillFromProfile?: "institution" | "course" | "year";
}

interface Speaker {
  name: string;
  designation: string;
  company: string;
  linkedin: string;
  imageUrl?: string;
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

interface Event {
  _id: string;
  title: string;
  description: string;
  venue: string;
  venueIframeLink?: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  bannerUrl?: string;
  organizer?: string;
  registrationLink?: string;
  whatsappGroup?: string;
  category?: string;
  maxAttendees?: number;
  currentAttendees?: number;
  price?: number;
  theme?: string;
  isFeatured?: boolean;
  speakers?: Speaker[];
  schedule?: Schedule[];
  benefits?: string[];
  partners?: Partner[];
  requiredProfileFields?: {
    institution: boolean;
    course: boolean;
    year: boolean;
  };
  registrationForm?: RegistrationField[];
  ticketSettings?: {
    autoGenerate: boolean;
    sendEmail: boolean;
    manualApproval: boolean;
  };
}

interface UserTicket {
  _id: string;
  eventId: Event;
  qrCode: string;
  token: string;
  checkedIn: boolean;
  checkInTime?: string;
  checkOutTime?: string;
  createdAt: string;
}

// Enhanced Ticket Modal Component
function TicketModal({ ticket, isOpen, onClose }: { ticket: UserTicket | null; isOpen: boolean; onClose: () => void }) {
  const [copying, setCopying] = useState(false);

  if (!isOpen || !ticket) return null;

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (error) {
      console.error("Error formatting date:", error);
      return "Invalid Date";
    }
  };

  const formatTime = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      console.error("Error formatting time:", error);
      return "Invalid Time";
    }
  };

  const downloadTicket = () => {
    try {
      const link = document.createElement('a');
      link.href = ticket.qrCode;
      link.download = `ticket-${ticket.eventId.title}-${ticket.token}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Ticket downloaded successfully!");
    } catch (error) {
      toast.error("Failed to download ticket");
    }
  };

  const copyToken = async () => {
    try {
      setCopying(true);
      await navigator.clipboard.writeText(ticket.token);
      toast.success("Ticket token copied to clipboard!");
    } catch (error) {
      toast.error("Failed to copy token");
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-100">
        {/* Header */}
        <div className="relative p-6 pb-8 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 rounded-t-3xl">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="absolute top-4 right-4 h-10 w-10 p-0 rounded-full bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm"
          >
            <X className="h-5 w-5" />
          </Button>
          <div className="text-center text-white">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl mb-4">
              <Ticket className="h-8 w-8" />
            </div>
            <h2 className="text-2xl font-bold mb-1">Event Ticket</h2>
            <p className="text-blue-100 text-sm">Digital Access Pass</p>
          </div>
        </div>

        {/* Ticket Content */}
        <div className="p-6 space-y-6">
          {/* Event Info */}
          <div className="text-center">
            <h3 className="text-xl font-bold text-gray-900 mb-4 line-clamp-2 px-2">
              {ticket.eventId.title}
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-center space-x-3 bg-gray-50 rounded-xl py-3 px-4">
                <Calendar className="h-5 w-5 text-blue-600 flex-shrink-0" />
                <span className="text-gray-700 font-medium">{formatDate(ticket.eventId.startDate)}</span>
              </div>
              <div className="flex items-center justify-center space-x-3 bg-gray-50 rounded-xl py-3 px-4">
                <MapPin className="h-5 w-5 text-green-600 flex-shrink-0" />
                <span className="text-gray-700 font-medium truncate">{ticket.eventId.venue}</span>
              </div>
              {ticket.checkedIn && ticket.checkInTime && (
                <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 animate-in slide-in-from-bottom-2">
                  <p className="text-green-800 font-semibold flex items-center justify-center">
                    <CheckCircle className="h-5 w-5 mr-2" />
                    Checked in at {formatTime(ticket.checkInTime)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center space-y-4">
            <div className="bg-white p-6 rounded-2xl border-2 border-gray-200 shadow-xl hover:shadow-2xl transition-all duration-300">
              <img 
                src={ticket.qrCode} 
                alt="QR Code"
                className="w-56 h-56"
              />
            </div>
            <p className="text-sm text-gray-600 text-center font-medium">
              Present this QR code at the event entrance
            </p>
          </div>

          {/* Ticket Details */}
          <div className="bg-gradient-to-br from-gray-50 to-blue-50 rounded-2xl p-5 space-y-4 border border-gray-200">
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-700">Status:</span>
              <Badge 
                variant={ticket.checkedIn ? "success" : "default"}
                className="font-semibold px-4 py-1.5 text-xs"
              >
                {ticket.checkedIn ? "Checked In" : "Active"}
              </Badge>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-700">Token:</span>
              <div className="flex items-center space-x-2">
                <code className="text-xs bg-white px-3 py-2 rounded-lg border border-gray-200 font-mono font-medium">
                  {ticket.token.substring(0, 8)}...
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyToken}
                  disabled={copying}
                  className="h-8 w-8 p-0 hover:bg-white rounded-lg"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-700">Issued:</span>
              <span className="text-sm text-gray-600 font-medium">
                {formatDate(ticket.createdAt)}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={downloadTicket}
              className="flex-1 border-2 border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200 h-12 font-semibold"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Button
              onClick={onClose}
              className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 h-12 font-semibold shadow-lg hover:shadow-xl transition-all duration-200"
            >
              Close
            </Button>
          </div>

          {/* Instructions */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-5">
            <h4 className="text-sm font-bold text-blue-900 mb-3 flex items-center">
              <AlertCircle className="h-4 w-4 mr-2" />
              Important Instructions
            </h4>
            <ul className="text-xs text-blue-800 space-y-2">
              <li className="flex items-start">
                <span className="text-blue-600 mr-2 font-bold">•</span>
                <span>Keep this ticket safe and accessible during the event</span>
              </li>
              <li className="flex items-start">
                <span className="text-blue-600 mr-2 font-bold">•</span>
                <span>Present the QR code at the entrance for scanning</span>
              </li>
              <li className="flex items-start">
                <span className="text-blue-600 mr-2 font-bold">•</span>
                <span>Download or screenshot for offline access</span>
              </li>
              {!ticket.checkedIn && (
                <li className="flex items-start">
                  <span className="text-blue-600 mr-2 font-bold">•</span>
                  <span>Check-in will be required upon arrival</span>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// Loading Skeleton Component
function EventLoadingSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50">
      {/* Header Skeleton */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="h-10 w-32 bg-gray-200 rounded-lg animate-pulse"></div>
            <div className="flex gap-2">
              <div className="h-10 w-24 bg-gray-200 rounded-lg animate-pulse"></div>
              <div className="h-10 w-10 bg-gray-200 rounded-lg animate-pulse"></div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content Skeleton */}
          <div className="lg:col-span-2 space-y-6">
            <div className="h-96 bg-gray-200 rounded-3xl animate-pulse"></div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-24 bg-gray-200 rounded-2xl animate-pulse"></div>
              ))}
            </div>
            <div className="h-96 bg-gray-200 rounded-3xl animate-pulse"></div>
          </div>

          {/* Sidebar Skeleton */}
          <div className="space-y-6">
            <div className="h-96 bg-gray-200 rounded-3xl animate-pulse"></div>
            <div className="h-48 bg-gray-200 rounded-3xl animate-pulse"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EventSlugPage() {
  const { slug } = useParams();
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRegistration, setShowRegistration] = useState(false);
  const [userRegistered, setUserRegistered] = useState(false);
  const [userTicket, setUserTicket] = useState<UserTicket | null>(null);
  const [registrationCount, setRegistrationCount] = useState(0);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  // Check if user is authenticated
  useEffect(() => {
    const checkAuth = () => {
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('token');
        setIsAuthenticated(!!token);
      }
    };

    checkAuth();
  }, []);

  useEffect(() => {
    if (!slug) return;

    const fetchEvent = async () => {
      try {
        setLoading(true);
        const res = await api.get(`/events/slug/${slug}`);
        if (res.data?.success) {
          setEvent(res.data.event);
          try {
            const countRes = await api.get(`/registration/responses/${res.data.event._id}/count`);
            if (countRes.data.success) {
              setRegistrationCount(countRes.data.count);
            }
          } catch (countErr) {
            console.error("Failed to fetch registration count", countErr);
          }
        } else {
          setError(res.data?.message || "Event not found");
        }
      } catch (err: any) {
        console.error("Fetch event error:", err);
        setError(err.response?.data?.message || "Failed to fetch event");
        toast.error("Failed to load event details");
      } finally {
        setLoading(false);
      }
    };

    fetchEvent();
  }, [slug]);

  const checkRegistrationStatus = async () => {
    if (!event) return;
    
    try {
      const res = await api.get(`/registration/responses/status/${event._id}`);
      setUserRegistered(res.data.registered);
      
      if (res.data.registered) {
        const ticketsRes = await api.get("/tickets/user-tickets");
        const eventTicket = ticketsRes.data.tickets.find((t: any) => t.eventId._id === event._id);
        setUserTicket(eventTicket);
      }
    } catch (error) {
      console.error("Error checking registration status:", error);
    }
  };

  useEffect(() => {
    if (event) {
      checkRegistrationStatus();
    }
  }, [event]);

  const handleRegisterClick = () => {
    if (!isAuthenticated) {
      toast.error("Please login to register for this event");
      const currentUrl = window.location.pathname + window.location.search;
      router.push(`/login?returnUrl=${encodeURIComponent(currentUrl)}`);
      return;
    }
    setShowRegistration(true);
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (error) {
      console.error("Error formatting date:", error);
      return "Invalid Date";
    }
  };

  const formatTime = (timeString?: string) => {
    if (!timeString) return "";
    try {
      return new Date(`2000-01-01T${timeString}`).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      console.error("Error formatting time:", error);
      return "Invalid Time";
    }
  };

  const formatShortDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch (error) {
      console.error("Error formatting short date:", error);
      return "Invalid Date";
    }
  };

  const formatScheduleDate = (dateString: string) => {
    try {
      if (dateString.includes('-')) {
        const parts = dateString.split('-');
        if (parts.length === 3) {
          const [day, month, year] = parts;
          return new Date(`${year}-${month}-${day}`).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          });
        }
      }
      return new Date(dateString).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (error) {
      console.error("Error formatting schedule date:", error);
      return dateString;
    }
  };

  const handleViewTicket = () => {
    if (userTicket) {
      setShowTicketModal(true);
    } else {
      toast.error("Ticket not found. Please try again.");
    }
  };

  const handleRegisterSuccess = () => {
    setShowRegistration(false);
    checkRegistrationStatus();
    if (event) {
      api.get(`/registration/responses/${event._id}/count`)
        .then(res => {
          if (res.data.success) {
            setRegistrationCount(res.data.count);
          }
        })
        .catch(console.error);
    }
  };

  const shareEvent = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: event?.title,
          text: event?.description,
          url: window.location.href,
        });
      } catch (err) {
        console.log('Error sharing:', err);
      }
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast.success("Event link copied to clipboard!");
    }
  };

  const toggleBookmark = () => {
    setIsBookmarked(!isBookmarked);
    toast.success(isBookmarked ? "Removed from bookmarks" : "Added to bookmarks");
  };

  const isEventFull = event?.maxAttendees && registrationCount >= event.maxAttendees;
  const isEventPast = event ? new Date(event.endDate) < new Date() : false;

  if (loading) {
    return <EventLoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md bg-white rounded-3xl shadow-2xl p-8 border border-gray-100">
          <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="h-10 w-10 text-red-500" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Event Not Found</h1>
          <p className="text-gray-600 mb-8 text-lg">{error}</p>
          <div className="space-y-3">
            <Button 
              onClick={() => router.push('/events')}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 h-12 text-base font-semibold shadow-lg"
            >
              Browse All Events
            </Button>
            <Button 
              variant="outline" 
              onClick={() => window.location.reload()}
              className="w-full border-2 border-gray-300 hover:border-blue-400 hover:bg-blue-50 h-12 text-base font-semibold"
            >
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!event) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50">
      {/* Header Navigation */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40 backdrop-blur-lg bg-white/95">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => router.push('/events')}
              className="hover:bg-gray-100 font-semibold"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Events
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={shareEvent}
                className="hover:bg-gray-100"
              >
                <Share2 className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Share</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleBookmark}
                className={`hover:bg-gray-100 ${isBookmarked ? 'text-yellow-600' : ''}`}
              >
                <Bookmark className={`h-4 w-4 ${isBookmarked ? 'fill-current' : ''}`} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Left Column - Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Event Image */}
            <div className="relative group overflow-hidden rounded-3xl shadow-2xl bg-white">
              {event.bannerUrl ? (
                <div className="relative aspect-[16/9] lg:aspect-[21/9]">
                  <ImageWithFallback
                    src={event.bannerUrl}
                    alt={event.title}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                </div>
              ) : (
                <div className="aspect-[16/9] lg:aspect-[21/9] bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 flex items-center justify-center">
                  <div className="text-center text-white p-8">
                    <Calendar className="h-16 w-16 mx-auto mb-4 opacity-80" />
                    <span className="text-2xl font-bold">{event.title}</span>
                  </div>
                </div>
              )}
              <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                {event.category && (
                  <Badge className="bg-white text-gray-800 border-0 shadow-lg px-4 py-2 font-semibold text-sm">
                    {event.category}
                  </Badge>
                )}
                {event.isFeatured && (
                  <Badge className="bg-yellow-500 text-white border-0 shadow-lg px-4 py-2 font-semibold text-sm">
                    <Star className="h-3.5 w-3.5 mr-1 fill-current" />
                    Featured
                  </Badge>
                )}
                {isEventPast && (
                  <Badge variant="secondary" className="bg-gray-600 text-white border-0 shadow-lg px-4 py-2 font-semibold text-sm">
                    Past Event
                  </Badge>
                )}
              </div>
            </div>

            {/* Event Title - Mobile */}
            <div className="lg:hidden bg-white rounded-3xl p-6 shadow-lg border border-gray-100">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">{event.title}</h1>
              <p className="text-gray-600 leading-relaxed">{event.description}</p>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
              <div className="bg-white rounded-2xl p-4 lg:p-5 text-center border border-gray-100 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <Users className="h-6 w-6 lg:h-7 lg:w-7 text-blue-600 mx-auto mb-2" />
                <p className="text-2xl lg:text-3xl font-bold text-gray-900">{registrationCount}</p>
                <p className="text-xs text-gray-600 font-medium">Registered</p>
                {event.maxAttendees && (
                  <p className="text-xs text-gray-500 mt-1">
                    of {event.maxAttendees}
                  </p>
                )}
              </div>
              <div className="bg-white rounded-2xl p-4 lg:p-5 text-center border border-gray-100 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <Calendar className="h-6 w-6 lg:h-7 lg:w-7 text-green-600 mx-auto mb-2" />
                <p className="text-lg lg:text-xl font-bold text-gray-900">
                  {formatShortDate(event.startDate)}
                </p>
                <p className="text-xs text-gray-600 font-medium">Date</p>
              </div>
              <div className="bg-white rounded-2xl p-4 lg:p-5 text-center border border-gray-100 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <MapPin className="h-6 w-6 lg:h-7 lg:w-7 text-purple-600 mx-auto mb-2" />
                <p className="text-sm lg:text-base font-bold text-gray-900 truncate">
                  {event.venue.split(',')[0]}
                </p>
                <p className="text-xs text-gray-600 font-medium">Venue</p>
              </div>
              <div className="bg-white rounded-2xl p-4 lg:p-5 text-center border border-gray-100 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                <Ticket className="h-6 w-6 lg:h-7 lg:w-7 text-orange-600 mx-auto mb-2" />
                <p className="text-lg lg:text-xl font-bold text-gray-900">
                  {event.price === 0 ? 'Free' : `${event.price}`}
                </p>
                <p className="text-xs text-gray-600 font-medium">Price</p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="bg-white rounded-3xl border border-gray-100 shadow-xl overflow-hidden">
              <div className="flex overflow-x-auto border-b border-gray-200 scrollbar-hide">
                {['overview', 'schedule', 'speakers', 'benefits', 'partners', 'location'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 min-w-[100px] px-4 py-4 text-sm font-semibold transition-all duration-200 whitespace-nowrap ${
                      activeTab === tab
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="p-6 lg:p-8">
                {/* Overview Tab */}
                {activeTab === 'overview' && (
                  <div className="space-y-8">
                    <div className="hidden lg:block">
                      <h2 className="text-3xl font-bold text-gray-900 mb-6">About This Event</h2>
                      <p className="text-gray-700 leading-relaxed text-lg">
                        {event.description}
                      </p>
                    </div>

                    {/* Key Information */}
                    <div>
                      <h3 className="text-2xl font-bold text-gray-900 mb-6">Event Details</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-5">
                          <div className="flex items-start space-x-4">
                            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                              <MapPin className="h-6 w-6 text-green-600" />
                            </div>
                            <div>
                              <p className="font-bold text-gray-900 text-lg mb-1">Venue</p>
                              <p className="text-gray-600">{event.venue}</p>
                            </div>
                          </div>
                          <div className="flex items-start space-x-4">
                            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                              <Calendar className="h-6 w-6 text-blue-600" />
                            </div>
                            <div>
                              <p className="font-bold text-gray-900 text-lg mb-1">Date</p>
                              <p className="text-gray-600">
                                {formatDate(event.startDate)}
                                {event.endDate && event.endDate !== event.startDate && ` - ${formatDate(event.endDate)}`}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-5">
                          <div className="flex items-start space-x-4">
                            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center flex-shrink-0">
                              <Clock className="h-6 w-6 text-purple-600" />
                            </div>
                            <div>
                              <p className="font-bold text-gray-900 text-lg mb-1">Time</p>
                              <p className="text-gray-600">
                                {event.startTime && formatTime(event.startTime)}
                                {event.endTime && ` - ${formatTime(event.endTime)}`}
                              </p>
                            </div>
                          </div>
                          {event.organizer && (
                            <div className="flex items-start space-x-4">
                              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                <User className="h-6 w-6 text-orange-600" />
                              </div>
                              <div>
                                <p className="font-bold text-gray-900 text-lg mb-1">Organizer</p>
                                <p className="text-gray-600">{event.organizer}</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Schedule Tab */}
                {activeTab === 'schedule' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-6">Event Schedule</h2>
                    {event.schedule && event.schedule.length > 0 ? (
                      <div className="space-y-4">
                        {event.schedule.map((item, index) => (
                          <div 
                            key={index}
                            className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-5 lg:p-6 border border-blue-200 shadow-sm hover:shadow-lg transition-all duration-300"
                          >
                            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex items-start space-x-3 mb-3">
                                  <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center text-white font-bold text-base flex-shrink-0">
                                    {index + 1}
                                  </div>
                                  <div className="flex-1">
                                    <h3 className="text-lg lg:text-xl font-bold text-gray-900 mb-2">{item.title}</h3>
                                    <p className="text-gray-700 mb-3 leading-relaxed">{item.description}</p>
                                    {item.speakers && item.speakers.length > 0 && (
                                      <div className="flex items-center text-sm text-gray-600 bg-white rounded-lg px-3 py-2 w-fit">
                                        <Mic className="h-4 w-4 mr-2 text-purple-600 flex-shrink-0" />
                                        <span className="font-medium">Speakers: {item.speakers.join(', ')}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="lg:text-right lg:ml-6">
                                <div className="bg-white rounded-xl px-4 py-3 shadow-md border border-blue-200">
                                  <p className="font-bold text-gray-900 text-base mb-1">{item.time}</p>
                                  <p className="text-gray-600 text-sm">{formatScheduleDate(item.day)}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-16 bg-gray-50 rounded-2xl">
                        <Clock3 className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg font-medium">Schedule details coming soon</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Speakers Tab */}
                {activeTab === 'speakers' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-6">Featured Speakers</h2>
                    {event.speakers && event.speakers.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 lg:gap-6">
                        {event.speakers.map((speaker, index) => (
                          <div 
                            key={index}
                            className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
                          >
                            <div className="flex items-start space-x-4">
                              <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
                                {speaker.name.split(' ').map(n => n[0]).join('')}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="text-xl font-bold text-gray-900 mb-2 truncate">{speaker.name}</h3>
                                <p className="text-gray-600 font-semibold mb-1">{speaker.designation}</p>
                                {speaker.company && (
                                  <p className="text-gray-500 text-sm mb-3">{speaker.company}</p>
                                )}
                                {speaker.linkedin && (
                                  <a
                                    href={speaker.linkedin}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center text-blue-600 hover:text-blue-800 font-semibold text-sm transition-colors"
                                  >
                                    Connect on LinkedIn
                                    <ExternalLink className="h-4 w-4 ml-1 flex-shrink-0" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-16 bg-gray-50 rounded-2xl">
                        <Mic className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg font-medium">Speaker information coming soon</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Benefits Tab */}
                {activeTab === 'benefits' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-6">What You'll Gain</h2>
                    {event.benefits && event.benefits.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {event.benefits.map((benefit, index) => (
                          <div 
                            key={index}
                            className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-5 lg:p-6 border border-green-200 shadow-sm hover:shadow-md transition-all duration-300"
                          >
                            <div className="flex items-center space-x-4">
                              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                                <Gift className="h-6 w-6 text-green-600" />
                              </div>
                              <p className="text-gray-800 font-semibold text-base">{benefit}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-16 bg-gray-50 rounded-2xl">
                        <Gift className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg font-medium">Benefits information coming soon</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Partners Tab */}
                {activeTab === 'partners' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-6">Event Partners</h2>
                    {event.partners && event.partners.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
                        {event.partners.map((partner, index) => (
                          <div 
                            key={index}
                            className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 text-center"
                          >
                            <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">
                              {partner.name.split(' ').map(n => n[0]).join('')}
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">{partner.name}</h3>
                            <p className="text-gray-600 font-semibold mb-4 text-sm">{partner.role}</p>
                            {partner.website && (
                              <a
                                href={partner.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center text-blue-600 hover:text-blue-800 font-semibold text-sm"
                              >
                                <Globe className="h-4 w-4 mr-1" />
                                Visit Website
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-16 bg-gray-50 rounded-2xl">
                        <Handshake className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg font-medium">Partner information coming soon</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Location Tab */}
                {activeTab === 'location' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-6">Event Location</h2>
                    <div className="space-y-5">
                      <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg">
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center mr-3">
                            <MapPin className="h-5 w-5 text-green-600" />
                          </div>
                          Venue Address
                        </h3>
                        <p className="text-gray-700 text-lg ml-13">{event.venue}</p>
                      </div>
                      
                      {event.venueIframeLink && (
                        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-lg">
                          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mr-3">
                              <Globe className="h-5 w-5 text-blue-600" />
                            </div>
                            Interactive Map
                          </h3>
                          <div className="relative h-64 lg:h-96 rounded-xl overflow-hidden border-2 border-gray-200">
                            <iframe
                              src={event.venueIframeLink}
                              width="100%"
                              height="100%"
                              style={{ border: 0 }}
                              allowFullScreen
                              loading="lazy"
                              referrerPolicy="no-referrer-when-downgrade"
                              title={`Location map for ${event.title}`}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Registration & Info Cards */}
          <div className="space-y-6">
            {/* Registration Card */}
            <div className="bg-white rounded-3xl border border-gray-100 shadow-xl p-6 lg:p-8 sticky top-24">
              <div className="text-center mb-6">
                <h3 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-3">Join This Event</h3>
                <div className="w-20 h-1.5 bg-gradient-to-r from-blue-600 to-purple-600 mx-auto rounded-full"></div>
              </div>

              {!userRegistered ? (
                <div className="space-y-4">
                  {event.registrationLink ? (
                    <a
                      href={event.registrationLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-full px-6 py-4 lg:py-5 border border-transparent text-lg font-bold rounded-2xl text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-xl hover:shadow-2xl hover:-translate-y-1"
                    >
                      Register on External Site
                      <ExternalLink className="h-5 w-5 ml-2" />
                    </a>
                  ) : (
                    <Button
                      onClick={handleRegisterClick}
                      disabled={isEventFull || isEventPast}
                      className="w-full px-6 py-4 lg:py-5 text-lg font-bold rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-xl hover:shadow-2xl hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                    >
                      {isEventPast ? 'Event Ended' : isEventFull ? 'Event Full' : 'Register Now'}
                    </Button>
                  )}
                  
                  {isEventFull && !isEventPast && (
                    <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-4">
                      <p className="text-orange-800 text-sm font-semibold text-center flex items-center justify-center">
                        <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0" />
                        Event has reached maximum capacity
                      </p>
                    </div>
                  )}

                  {event.price !== undefined && event.price > 0 && (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-4">
                      <p className="text-blue-900 text-base font-bold text-center flex items-center justify-center">
                        <Crown className="h-5 w-5 mr-2 flex-shrink-0" />
                        Entry Fee: ${event.price}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-2xl p-6">
                    <p className="text-green-800 font-bold flex items-center justify-center text-lg mb-5">
                      <CheckCircle className="h-6 w-6 mr-2" />
                      You're Registered!
                    </p>
                    <div className="space-y-3">
                      <Button 
                        onClick={handleViewTicket}
                        className="w-full h-12 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 transition-all duration-200 shadow-lg hover:shadow-xl font-bold text-base rounded-xl"
                      >
                        <QrCode className="h-5 w-5 mr-2" />
                        View Your Ticket
                      </Button>
                      <Button 
                        onClick={() => router.push('/user/profile?tab=tickets')}
                        variant="outline"
                        className="w-full h-12 border-2 border-green-300 text-green-700 hover:bg-green-100 transition-all duration-200 font-bold text-base rounded-xl"
                      >
                        All Tickets
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Additional Links */}
              <div className="space-y-4 mt-6 pt-6 border-t border-gray-200">
                {event.whatsappGroup && (
                  <a
                    href={event.whatsappGroup}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center w-full px-5 py-3.5 border-2 border-green-600 text-base font-bold rounded-xl text-green-600 bg-white hover:bg-green-50 transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    Join WhatsApp Group
                    <ExternalLink className="h-4 w-4 ml-2" />
                  </a>
                )}
                
                {/* Capacity Progress */}
                {event.maxAttendees && (
                  <div className="bg-gray-50 rounded-2xl p-5">
                    <div className="flex justify-between text-sm font-bold text-gray-700 mb-3">
                      <span>Event Capacity</span>
                      <span>{registrationCount} / {event.maxAttendees}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-gradient-to-r from-green-500 to-blue-500 h-3 rounded-full transition-all duration-500 shadow-md"
                        style={{ 
                          width: `${Math.min((registrationCount / event.maxAttendees) * 100, 100)}%` 
                        }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Info Card */}
            <div className="bg-white rounded-3xl border border-gray-100 shadow-xl p-6 lg:p-8">
              <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mr-3">
                  <Info className="h-5 w-5 text-blue-600" />
                </div>
                Quick Information
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b border-gray-100">
                  <span className="text-gray-600 font-semibold">Category:</span>
                  <span className="font-bold text-gray-900">{event.category || 'General'}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-gray-100">
                  <span className="text-gray-600 font-semibold">Date:</span>
                  <span className="font-bold text-gray-900">{formatShortDate(event.startDate)}</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-gray-100">
                  <span className="text-gray-600 font-semibold">Time:</span>
                  <span className="font-bold text-gray-900 text-sm">
                    {event.startTime && formatTime(event.startTime)}
                    {event.endTime && ` - ${formatTime(event.endTime)}`}
                  </span>
                </div>
                {event.theme && (
                  <div className="flex justify-between items-center py-3">
                    <span className="text-gray-600 font-semibold">Theme:</span>
                    <span className="font-bold text-gray-900">{event.theme}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Registration Form Modal */}
      {showRegistration && (
        <RegistrationForm
          eventId={event._id}
          eventTitle={event.title}
          requiredProfileFields={event.requiredProfileFields || {
            institution: false,
            course: false,
            year: false,
          }}
          customFields={event.registrationForm || []}
          onSuccess={handleRegisterSuccess}
          onCancel={() => setShowRegistration(false)}
        />
      )}

      {/* Ticket Modal */}
      <TicketModal 
        ticket={userTicket}
        isOpen={showTicketModal}
        onClose={() => setShowTicketModal(false)}
      />
    </div>
  );
}