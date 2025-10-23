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
  Crown
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300 shadow-2xl border border-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-t-2xl">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Ticket className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Your Event Ticket</h2>
              <p className="text-sm text-blue-600">Digital Access Pass</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 hover:bg-white/50 rounded-lg transition-all"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Ticket Content */}
        <div className="p-6 space-y-6">
          {/* Event Info */}
          <div className="text-center">
            <h3 className="text-lg font-bold text-gray-900 mb-3 line-clamp-2">
              {ticket.eventId.title}
            </h3>
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex items-center justify-center space-x-2 bg-gray-50 rounded-lg py-2">
                <Calendar className="h-4 w-4 text-blue-500" />
                <span>{formatDate(ticket.eventId.startDate)}</span>
              </div>
              <div className="flex items-center justify-center space-x-2 bg-gray-50 rounded-lg py-2">
                <MapPin className="h-4 w-4 text-green-500" />
                <span className="max-w-xs truncate">{ticket.eventId.venue}</span>
              </div>
              {ticket.checkedIn && ticket.checkInTime && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-2 animate-in slide-in-from-bottom-2">
                  <p className="text-green-800 font-medium flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Checked in at {formatTime(ticket.checkInTime)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center space-y-4">
            <div className="bg-white p-4 rounded-xl border-2 border-gray-200 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
              <img 
                src={ticket.qrCode} 
                alt="QR Code"
                className="w-56 h-56"
              />
            </div>
            <p className="text-sm text-gray-500 text-center font-medium">
              Scan this QR code for event entry
            </p>
          </div>

          {/* Ticket Details */}
          <div className="bg-gradient-to-br from-gray-50 to-blue-50 rounded-xl p-4 space-y-3 border border-gray-200">
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-700">Ticket Status:</span>
              <Badge 
                variant={ticket.checkedIn ? "success" : "default"}
                className="font-medium px-3 py-1"
              >
                {ticket.checkedIn ? "Checked In" : "Active"}
              </Badge>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-700">Token:</span>
              <div className="flex items-center space-x-2">
                <code className="text-xs bg-white px-3 py-1.5 rounded-lg border font-mono">
                  {ticket.token.substring(0, 8)}...
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyToken}
                  disabled={copying}
                  className="h-7 w-7 p-0 hover:bg-white transition-colors"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-gray-700">Created:</span>
              <span className="text-sm text-gray-600 font-medium">
                {formatDate(ticket.createdAt)}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3">
            <Button
              variant="outline"
              onClick={downloadTicket}
              className="flex-1 border-2 hover:border-blue-300 hover:bg-blue-50 transition-all duration-200"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Button
              onClick={onClose}
              className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              <Ticket className="h-4 w-4 mr-2" />
              Close
            </Button>
          </div>

          {/* Instructions */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 animate-in slide-in-from-bottom-2">
            <h4 className="text-sm font-bold text-blue-800 mb-2 flex items-center">
              <AlertCircle className="h-4 w-4 mr-2" />
              Important Instructions:
            </h4>
            <ul className="text-xs text-blue-700 space-y-1.5">
              <li className="flex items-start">
                <span className="text-blue-500 mr-2">•</span>
                Keep this ticket safe and accessible during the event
              </li>
              <li className="flex items-start">
                <span className="text-blue-500 mr-2">•</span>
                Show the QR code at the entrance for scanning
              </li>
              <li className="flex items-start">
                <span className="text-blue-500 mr-2">•</span>
                Download or screenshot the ticket for offline access
              </li>
              {!ticket.checkedIn && (
                <li className="flex items-start">
                  <span className="text-blue-500 mr-2">•</span>
                  Check-in will be required upon arrival
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header Skeleton */}
      <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center space-x-4 mb-6">
            <div className="h-10 w-10 bg-white/20 rounded-lg animate-pulse"></div>
            <div className="space-y-2">
              <div className="h-8 w-48 bg-white/20 rounded animate-pulse"></div>
              <div className="h-4 w-32 bg-white/20 rounded animate-pulse"></div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Image Skeleton */}
          <div className="space-y-4">
            <div className="h-80 lg:h-96 bg-gray-200 rounded-2xl animate-pulse"></div>
            <div className="h-4 w-24 bg-gray-200 rounded animate-pulse"></div>
          </div>

          {/* Content Skeleton */}
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="h-8 w-3/4 bg-gray-200 rounded animate-pulse"></div>
              <div className="h-4 w-full bg-gray-200 rounded animate-pulse"></div>
              <div className="h-4 w-2/3 bg-gray-200 rounded animate-pulse"></div>
            </div>
            
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center space-x-3">
                  <div className="h-5 w-5 bg-gray-200 rounded animate-pulse"></div>
                  <div className="space-y-2">
                    <div className="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
                    <div className="h-3 w-32 bg-gray-200 rounded animate-pulse"></div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-4 pt-4">
              <div className="h-12 w-32 bg-gray-200 rounded-lg animate-pulse"></div>
              <div className="h-12 w-32 bg-gray-200 rounded-lg animate-pulse"></div>
            </div>
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

  useEffect(() => {
    if (!slug) return;

    const fetchEvent = async () => {
      try {
        setLoading(true);
        const res = await api.get(`/events/slug/${slug}`);
        if (res.data?.success) {
          setEvent(res.data.event);
          // Fetch registration count
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
      
      // If registered, check for ticket
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
      // Handle different date formats
      if (dateString.includes('-')) {
        const parts = dateString.split('-');
        if (parts.length === 3) {
          // Handle DD-MM-YYYY format
          const [day, month, year] = parts;
          return new Date(`${year}-${month}-${day}`).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          });
        }
      }
      // Fallback to standard date parsing
      return new Date(dateString).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (error) {
      console.error("Error formatting schedule date:", error);
      return dateString; // Return original string if parsing fails
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
    // Refetch registration count
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
      // Fallback: copy to clipboard
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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="h-10 w-10 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Event Not Found</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <div className="space-y-3">
            <Button 
              onClick={() => router.push('/events')}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            >
              Browse All Events
            </Button>
            <Button 
              variant="outline" 
              onClick={() => window.location.reload()}
              className="w-full border-2 hover:border-blue-300"
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header with Back Button */}
      <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 text-white shadow-2xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => router.push('/events')}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Events
            </Button>
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={shareEvent}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm"
              >
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleBookmark}
                className={`backdrop-blur-sm ${
                  isBookmarked 
                    ? 'bg-yellow-500/20 text-yellow-200 border-yellow-300/30' 
                    : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                }`}
              >
                <Bookmark className={`h-4 w-4 ${isBookmarked ? 'fill-current' : ''}`} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Event Image and Quick Info */}
          <div className="lg:col-span-2 space-y-8">
            {/* Event Image */}
            <div className="relative group">
              {event.bannerUrl ? (
                <div className="relative overflow-hidden rounded-2xl shadow-2xl">
                  <ImageWithFallback
                    src={event.bannerUrl}
                    alt={event.title}
                    className="w-full h-64 lg:h-96 object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>
              ) : (
                <div className="w-full h-64 lg:h-96 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-2xl">
                  <div className="text-center text-white">
                    <Calendar className="h-16 w-16 mx-auto mb-4 opacity-80" />
                    <span className="text-2xl font-bold">{event.title}</span>
                  </div>
                </div>
              )}
              <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                {event.category && (
                  <Badge className="bg-white/90 backdrop-blur-sm text-gray-800 border-0 shadow-lg px-3 py-2 font-semibold">
                    {event.category}
                  </Badge>
                )}
                {event.isFeatured && (
                  <Badge className="bg-yellow-500/90 backdrop-blur-sm text-white border-0 shadow-lg px-3 py-2 font-semibold">
                    <Star className="h-3 w-3 mr-1 fill-current" />
                    Featured
                  </Badge>
                )}
                {isEventPast && (
                  <Badge variant="secondary" className="bg-gray-500/90 backdrop-blur-sm text-white border-0 shadow-lg px-3 py-2 font-semibold">
                    Past Event
                  </Badge>
                )}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white/70 backdrop-blur-sm rounded-xl p-4 text-center border border-gray-200/60 shadow-lg hover:shadow-xl transition-all duration-300">
                <Users className="h-6 w-6 text-blue-600 mx-auto mb-2" />
                <p className="text-2xl font-bold text-gray-900">{registrationCount}</p>
                <p className="text-xs text-gray-600">Registered</p>
                {event.maxAttendees && (
                  <p className="text-xs text-gray-500 mt-1">
                    of {event.maxAttendees} total
                  </p>
                )}
              </div>
              <div className="bg-white/70 backdrop-blur-sm rounded-xl p-4 text-center border border-gray-200/60 shadow-lg hover:shadow-xl transition-all duration-300">
                <Calendar className="h-6 w-6 text-green-600 mx-auto mb-2" />
                <p className="text-lg font-bold text-gray-900">
                  {formatShortDate(event.startDate)}
                </p>
                <p className="text-xs text-gray-600">Date</p>
              </div>
              <div className="bg-white/70 backdrop-blur-sm rounded-xl p-4 text-center border border-gray-200/60 shadow-lg hover:shadow-xl transition-all duration-300">
                <MapPin className="h-6 w-6 text-purple-600 mx-auto mb-2" />
                <p className="text-sm font-bold text-gray-900 truncate">
                  {event.venue.split(',')[0]}
                </p>
                <p className="text-xs text-gray-600">Venue</p>
              </div>
              <div className="bg-white/70 backdrop-blur-sm rounded-xl p-4 text-center border border-gray-200/60 shadow-lg hover:shadow-xl transition-all duration-300">
                <Ticket className="h-6 w-6 text-orange-600 mx-auto mb-2" />
                <p className="text-lg font-bold text-gray-900">
                  {event.price === 0 ? 'Free' : `$${event.price}`}
                </p>
                <p className="text-xs text-gray-600">Price</p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-gray-200/60 shadow-lg">
              <div className="flex overflow-x-auto border-b border-gray-200/60">
                {['overview', 'schedule', 'speakers', 'benefits', 'partners', 'location'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 px-6 py-4 text-sm font-medium transition-all duration-200 ${
                      activeTab === tab
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50/50'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="p-6">
                {/* Overview Tab */}
                {activeTab === 'overview' && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 mb-4">About This Event</h2>
                      <p className="text-gray-600 leading-relaxed text-lg">
                        {event.description}
                      </p>
                    </div>

                    {/* Key Information */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="flex items-start space-x-3">
                          <MapPin className="h-5 w-5 text-green-500 mt-1 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-gray-900">Venue</p>
                            <p className="text-gray-600">{event.venue}</p>
                          </div>
                        </div>
                        <div className="flex items-start space-x-3">
                          <Calendar className="h-5 w-5 text-blue-500 mt-1 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-gray-900">Date</p>
                            <p className="text-gray-600">
                              {formatDate(event.startDate)}
                              {event.endDate && event.endDate !== event.startDate && ` - ${formatDate(event.endDate)}`}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-start space-x-3">
                          <Clock className="h-5 w-5 text-purple-500 mt-1 flex-shrink-0" />
                          <div>
                            <p className="font-semibold text-gray-900">Time</p>
                            <p className="text-gray-600">
                              {event.startTime && formatTime(event.startTime)}
                              {event.endTime && ` - ${formatTime(event.endTime)}`}
                            </p>
                          </div>
                        </div>
                        {event.organizer && (
                          <div className="flex items-start space-x-3">
                            <User className="h-5 w-5 text-orange-500 mt-1 flex-shrink-0" />
                            <div>
                              <p className="font-semibold text-gray-900">Organizer</p>
                              <p className="text-gray-600">{event.organizer}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Schedule Tab */}
                {activeTab === 'schedule' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl font-bold text-gray-900 mb-6">Event Schedule</h2>
                    {event.schedule && event.schedule.length > 0 ? (
                      <div className="space-y-4">
                        {event.schedule.map((item, index) => (
                          <div 
                            key={index}
                            className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200/60 shadow-sm hover:shadow-md transition-all duration-300"
                          >
                            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between">
                              <div className="flex-1">
                                <div className="flex items-start space-x-3 mb-3">
                                  <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm mt-1">
                                    {index + 1}
                                  </div>
                                  <div>
                                    <h3 className="text-xl font-semibold text-gray-900 mb-2">{item.title}</h3>
                                    <p className="text-gray-600 mb-3">{item.description}</p>
                                    {item.speakers && item.speakers.length > 0 && (
                                      <div className="flex items-center text-sm text-gray-500">
                                        <Mic className="h-4 w-4 mr-2 text-purple-500" />
                                        Speakers: {item.speakers.join(', ')}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="lg:text-right lg:ml-6 mt-4 lg:mt-0">
                                <div className="bg-white rounded-lg px-4 py-2 shadow-sm">
                                  <p className="font-semibold text-gray-900 text-sm">{item.time}</p>
                                  <p className="text-gray-600 text-sm">{formatScheduleDate(item.day)}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <Clock3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg">Schedule details coming soon</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Speakers Tab */}
                {activeTab === 'speakers' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl font-bold text-gray-900 mb-6">Featured Speakers</h2>
                    {event.speakers && event.speakers.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {event.speakers.map((speaker, index) => (
                          <div 
                            key={index}
                            className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1"
                          >
                            <div className="flex items-start space-x-4">
                              <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                                {speaker.name.split(' ').map(n => n[0]).join('')}
                              </div>
                              <div className="flex-1">
                                <h3 className="text-xl font-bold text-gray-900 mb-2">{speaker.name}</h3>
                                <p className="text-gray-600 font-medium mb-1">{speaker.designation}</p>
                                {speaker.company && (
                                  <p className="text-gray-500 text-sm mb-3">{speaker.company}</p>
                                )}
                                {speaker.linkedin && (
                                  <a
                                    href={speaker.linkedin}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium text-sm transition-colors"
                                  >
                                    Connect on LinkedIn
                                    <ExternalLink className="h-4 w-4 ml-1" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <Mic className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg">Speaker information coming soon</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Benefits Tab */}
                {activeTab === 'benefits' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl font-bold text-gray-900 mb-6">What You'll Gain</h2>
                    {event.benefits && event.benefits.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {event.benefits.map((benefit, index) => (
                          <div 
                            key={index}
                            className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200/60 shadow-sm hover:shadow-md transition-all duration-300"
                          >
                            <div className="flex items-center space-x-3">
                              <Gift className="h-6 w-6 text-green-600 flex-shrink-0" />
                              <p className="text-gray-800 font-medium">{benefit}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <Gift className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg">Benefits information coming soon</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Partners Tab */}
                {activeTab === 'partners' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl font-bold text-gray-900 mb-6">Event Partners</h2>
                    {event.partners && event.partners.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {event.partners.map((partner, index) => (
                          <div 
                            key={index}
                            className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm hover:shadow-md transition-all duration-300 text-center"
                          >
                            <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg mx-auto mb-4">
                              {partner.name.split(' ').map(n => n[0]).join('')}
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">{partner.name}</h3>
                            <p className="text-gray-600 font-medium mb-3">{partner.role}</p>
                            {partner.website && (
                              <a
                                href={partner.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center text-blue-600 hover:text-blue-800 font-medium text-sm"
                              >
                                <Globe className="h-4 w-4 mr-1" />
                                Visit Website
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <Handshake className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500 text-lg">Partner information coming soon</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Location Tab */}
                {activeTab === 'location' && (
                  <div className="space-y-6">
                    <h2 className="text-2xl font-bold text-gray-900 mb-6">Event Location</h2>
                    <div className="space-y-4">
                      <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                        <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                          <MapPin className="h-5 w-5 text-green-600 mr-2" />
                          Venue Address
                        </h3>
                        <p className="text-gray-600 text-lg">{event.venue}</p>
                      </div>
                      
                      {event.venueIframeLink && (
                        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
                          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                            <Globe className="h-5 w-5 text-blue-600 mr-2" />
                            Interactive Map
                          </h3>
                          <div className="relative h-96 rounded-lg overflow-hidden border-2 border-gray-200">
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

          {/* Right Column - Registration & Action Cards */}
          <div className="space-y-6">
            {/* Registration Card */}
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-gray-200/60 shadow-xl p-6 sticky top-6">
              <div className="text-center mb-6">
                <h3 className="text-2xl font-bold text-gray-900 mb-2">Join This Event</h3>
                <div className="w-16 h-1 bg-gradient-to-r from-blue-500 to-purple-600 mx-auto rounded-full"></div>
              </div>

              {!userRegistered ? (
                <div className="space-y-4">
                  {event.registrationLink ? (
                    <a
                      href={event.registrationLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-full px-6 py-4 border border-transparent text-lg font-semibold rounded-xl text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl"
                    >
                      Register on External Site
                      <ExternalLink className="h-5 w-5 ml-2" />
                    </a>
                  ) : (
                    <Button
                      onClick={() => setShowRegistration(true)}
                      disabled={isEventFull || isEventPast}
                      className="w-full px-6 py-4 text-lg font-semibold rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isEventPast ? 'Event Ended' : isEventFull ? 'Event Full' : 'Register Now'}
                    </Button>
                  )}
                  
                  {isEventFull && !isEventPast && (
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                      <p className="text-orange-800 text-sm font-medium text-center">
                        <AlertCircle className="h-4 w-4 inline mr-1" />
                        This event has reached maximum capacity
                      </p>
                    </div>
                  )}

                  {event.price !== undefined && event.price > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                      <p className="text-blue-800 text-sm font-semibold text-center">
                        <Crown className="h-4 w-4 inline mr-1" />
                        Price: ${event.price}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-6">
                    <p className="text-green-800 font-semibold flex items-center justify-center text-lg mb-4">
                      <CheckCircle className="h-6 w-6 mr-2" />
                      You're Registered!
                    </p>
                    <div className="space-y-3">
                      <Button 
                        onClick={handleViewTicket}
                        className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 transition-all duration-200 shadow-lg hover:shadow-xl"
                      >
                        <QrCode className="h-5 w-5 mr-2" />
                        View Your Ticket
                      </Button>
                      <Button 
                        onClick={() => router.push('/user/profile?tab=tickets')}
                        variant="outline"
                        className="w-full border-2 border-green-300 text-green-700 hover:bg-green-100 transition-all duration-200"
                      >
                        All Tickets
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Additional Links */}
              <div className="space-y-3 mt-6 pt-6 border-t border-gray-200/60">
                {event.whatsappGroup && (
                  <a
                    href={event.whatsappGroup}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center w-full px-4 py-3 border border-green-600 text-base font-semibold rounded-xl text-green-600 bg-white hover:bg-green-50 transition-all duration-200 shadow-sm hover:shadow-md"
                  >
                    Join WhatsApp Group
                    <ExternalLink className="h-4 w-4 ml-2" />
                  </a>
                )}
                
                {/* Capacity Progress */}
                {event.maxAttendees && (
                  <div className="bg-gray-50 rounded-xl p-4">
                    <div className="flex justify-between text-sm font-medium text-gray-700 mb-2">
                      <span>Capacity</span>
                      <span>{registrationCount} / {event.maxAttendees}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-green-500 to-blue-500 h-2 rounded-full transition-all duration-500"
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
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-gray-200/60 shadow-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Info className="h-5 w-5 text-blue-600 mr-2" />
                Quick Info
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Category:</span>
                  <span className="font-medium text-gray-900">{event.category || 'General'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Date:</span>
                  <span className="font-medium text-gray-900">{formatShortDate(event.startDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Time:</span>
                  <span className="font-medium text-gray-900">
                    {event.startTime && formatTime(event.startTime)}
                    {event.endTime && ` - ${formatTime(event.endTime)}`}
                  </span>
                </div>
                {event.theme && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Theme:</span>
                    <span className="font-medium text-gray-900">{event.theme}</span>
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

// Add missing Info icon component
function Info(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}