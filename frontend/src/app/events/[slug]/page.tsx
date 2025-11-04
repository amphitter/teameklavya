"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/utils/api";
import { getImageUrl, ImageWithFallback } from "@/utils/image";
import RegistrationForm from "@/components/RegistrationForm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/context/ThemeContext";
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
  Sun,
  Moon
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

// Types
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

// Theme Toggle Component
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <motion.button
      onClick={toggleTheme}
      className={`p-3 rounded-full backdrop-blur-sm transition-all duration-300 shadow-lg ${
        theme === 'dark'
          ? 'bg-slate-800/70 text-gray-300 hover:bg-slate-700'
          : 'bg-white/80 text-gray-700 hover:bg-white'
      }`}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </motion.button>
  );
}

// Ticket Modal Component
function TicketModal({ ticket, isOpen, onClose }: { ticket: UserTicket | null; isOpen: boolean; onClose: () => void }) {
  const [copying, setCopying] = useState(false);
  const { theme } = useTheme();

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
      <div className={`rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-300 shadow-2xl border ${
        theme === 'dark' ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`flex items-center justify-between p-6 border-b rounded-t-2xl ${
          theme === 'dark' 
            ? 'bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border-slate-600' 
            : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-gray-100'
        }`}>
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg ${
              theme === 'dark' ? 'bg-blue-500/20' : 'bg-blue-100'
            }`}>
              <Ticket className={`h-6 w-6 ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`} />
            </div>
            <div>
              <h2 className={`text-xl font-bold ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>
                Your Event Ticket
              </h2>
              <p className={`text-sm ${
                theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
              }`}>
                Digital Access Pass
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className={`h-8 w-8 p-0 rounded-lg transition-all ${
              theme === 'dark' 
                ? 'hover:bg-slate-700 text-gray-300' 
                : 'hover:bg-gray-100 text-gray-600'
            }`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Ticket Content */}
        <div className="p-6 space-y-6">
          {/* Event Info */}
          <div className="text-center">
            <h3 className={`text-lg font-bold mb-3 line-clamp-2 ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}>
              {ticket.eventId.title}
            </h3>
            <div className={`space-y-2 text-sm ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              <div className={`flex items-center justify-center space-x-2 rounded-lg py-2 ${
                theme === 'dark' ? 'bg-slate-700' : 'bg-gray-50'
              }`}>
                <Calendar className="h-4 w-4 text-blue-500" />
                <span>{formatDate(ticket.eventId.startDate)}</span>
              </div>
              <div className={`flex items-center justify-center space-x-2 rounded-lg py-2 ${
                theme === 'dark' ? 'bg-slate-700' : 'bg-gray-50'
              }`}>
                <MapPin className="h-4 w-4 text-green-500" />
                <span className="max-w-xs truncate">{ticket.eventId.venue}</span>
              </div>
              {ticket.checkedIn && ticket.checkInTime && (
                <div className={`border rounded-lg p-3 mt-2 animate-in slide-in-from-bottom-2 ${
                  theme === 'dark' 
                    ? 'bg-green-500/10 border-green-500/20 text-green-400'
                    : 'bg-green-50 border-green-200 text-green-800'
                }`}>
                  <p className="font-medium flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Checked in at {formatTime(ticket.checkInTime)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center space-y-4">
            <div className={`p-4 rounded-xl border-2 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 ${
              theme === 'dark' ? 'bg-slate-700 border-slate-600' : 'bg-white border-gray-200'
            }`}>
              <img 
                src={ticket.qrCode} 
                alt="QR Code"
                className="w-56 h-56"
              />
            </div>
            <p className={`text-sm text-center font-medium ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
            }`}>
              Scan this QR code for event entry
            </p>
          </div>

          {/* Ticket Details */}
          <div className={`rounded-xl p-4 space-y-3 border ${
            theme === 'dark' 
              ? 'bg-gradient-to-br from-slate-700/50 to-blue-500/10 border-slate-600' 
              : 'bg-gradient-to-br from-gray-50 to-blue-50 border-gray-200'
          }`}>
            <div className="flex justify-between items-center">
              <span className={`text-sm font-semibold ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Ticket Status:
              </span>
              <Badge 
                variant={ticket.checkedIn ? "success" : "default"}
                className="font-medium px-3 py-1"
              >
                {ticket.checkedIn ? "Checked In" : "Active"}
              </Badge>
            </div>
            
            <div className="flex justify-between items-center">
              <span className={`text-sm font-semibold ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Token:
              </span>
              <div className="flex items-center space-x-2">
                <code className={`text-xs px-3 py-1.5 rounded-lg border font-mono ${
                  theme === 'dark' ? 'bg-slate-700 border-slate-600 text-gray-300' : 'bg-white border-gray-200 text-gray-800'
                }`}>
                  {ticket.token.substring(0, 8)}...
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyToken}
                  disabled={copying}
                  className={`h-7 w-7 p-0 transition-colors ${
                    theme === 'dark' ? 'hover:bg-slate-600' : 'hover:bg-gray-100'
                  }`}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className={`text-sm font-semibold ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Created:
              </span>
              <span className={`text-sm font-medium ${
                theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {formatDate(ticket.createdAt)}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3">
            <Button
              variant="outline"
              onClick={downloadTicket}
              className={`flex-1 border-2 transition-all duration-200 ${
                theme === 'dark'
                  ? 'border-slate-600 hover:border-blue-400 hover:bg-blue-500/20'
                  : 'border-gray-300 hover:border-blue-300 hover:bg-blue-50'
              }`}
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Button
              onClick={onClose}
              className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl text-white"
            >
              <Ticket className="h-4 w-4 mr-2" />
              Close
            </Button>
          </div>

          {/* Instructions */}
          <div className={`border rounded-xl p-4 animate-in slide-in-from-bottom-2 ${
            theme === 'dark'
              ? 'bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border-blue-500/20'
              : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200'
          }`}>
            <h4 className={`text-sm font-bold mb-2 flex items-center ${
              theme === 'dark' ? 'text-blue-400' : 'text-blue-800'
            }`}>
              <AlertCircle className="h-4 w-4 mr-2" />
              Important Instructions:
            </h4>
            <ul className={`text-xs space-y-1.5 ${
              theme === 'dark' ? 'text-blue-300' : 'text-blue-700'
            }`}>
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
  const { theme } = useTheme();

  return (
    <div className={`min-h-screen transition-colors duration-300 ${
      theme === 'dark'
        ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950'
        : 'bg-white'
    }`}>
      {/* Theme Toggle */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      {/* Header Skeleton */}
      <div className={`transition-colors duration-300 ${
        theme === 'dark' 
          ? 'bg-gradient-to-r from-blue-600/20 via-purple-600/20 to-indigo-700/20' 
          : 'bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 text-white'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center space-x-4">
            <div className={`h-10 w-10 rounded-lg animate-pulse ${
              theme === 'dark' ? 'bg-white/20' : 'bg-white/20'
            }`}></div>
            <div className="space-y-2">
              <div className={`h-8 w-48 rounded animate-pulse ${
                theme === 'dark' ? 'bg-white/20' : 'bg-white/20'
              }`}></div>
              <div className={`h-4 w-32 rounded animate-pulse ${
                theme === 'dark' ? 'bg-white/20' : 'bg-white/20'
              }`}></div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Image Skeleton */}
          <div className="space-y-4">
            <div className={`h-80 lg:h-96 rounded-2xl animate-pulse ${
              theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200'
            }`}></div>
            <div className={`h-4 w-24 rounded animate-pulse ${
              theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200'
            }`}></div>
          </div>

          {/* Content Skeleton */}
          <div className="space-y-6">
            <div className="space-y-3">
              <div className={`h-8 w-3/4 rounded animate-pulse ${
                theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200'
              }`}></div>
              <div className={`h-4 w-full rounded animate-pulse ${
                theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200'
              }`}></div>
              <div className={`h-4 w-2/3 rounded animate-pulse ${
                theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200'
              }`}></div>
            </div>
            
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center space-x-3">
                  <div className={`h-5 w-5 rounded animate-pulse ${
                    theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200'
                  }`}></div>
                  <div className="space-y-2">
                    <div className={`h-4 w-20 rounded animate-pulse ${
                      theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200'
                    }`}></div>
                    <div className={`h-3 w-32 rounded animate-pulse ${
                      theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200'
                    }`}></div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-4 pt-4">
              <div className={`h-12 w-32 rounded-lg animate-pulse ${
                theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200'
              }`}></div>
              <div className={`h-12 w-32 rounded-lg animate-pulse ${
                theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200'
              }`}></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Error State Component
function EventErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { theme } = useTheme();

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 transition-colors duration-300 ${
      theme === 'dark'
        ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950'
        : 'bg-white'
    }`}>
      {/* Theme Toggle */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      <div className="text-center max-w-md">
        <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${
          theme === 'dark' ? 'bg-red-500/20' : 'bg-red-100'
        }`}>
          <AlertCircle className={`h-10 w-10 ${theme === 'dark' ? 'text-red-400' : 'text-red-600'}`} />
        </div>
        <h1 className={`text-2xl font-bold mb-2 ${
          theme === 'dark' ? 'text-white' : 'text-gray-900'
        }`}>
          Event Not Found
        </h1>
        <p className={`mb-6 ${
          theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
        }`}>
          {error}
        </p>
        <div className="space-y-3">
          <Button 
            onClick={() => window.history.back()}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
          >
            Browse All Events
          </Button>
          <Button 
            variant="outline" 
            onClick={onRetry}
            className={`w-full border-2 ${
              theme === 'dark' 
                ? 'border-slate-600 text-gray-300 hover:bg-slate-700' 
                : 'border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            Try Again
          </Button>
        </div>
      </div>
    </div>
  );
}

// Custom Image Component with Fallback
function EventImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  const { theme } = useTheme();
  const [imgError, setImgError] = useState(false);

  if (imgError || !src) {
    return (
      <div className={`w-full h-64 lg:h-96 rounded-2xl flex items-center justify-center shadow-2xl ${
        theme === 'dark' 
          ? 'bg-gradient-to-r from-blue-500/20 to-purple-600/20 border border-slate-700' 
          : 'bg-gradient-to-r from-blue-500 to-purple-600'
      } ${className}`}>
        <div className="text-center text-white">
          <Calendar className="h-16 w-16 mx-auto mb-4 opacity-80" />
          <span className="text-2xl font-bold">{alt}</span>
        </div>
      </div>
    );
  }

  return (
    <img 
      src={getImageUrl(src)} 
      alt={alt}
      className={className}
      onError={() => setImgError(true)}
    />
  );
}

// Main Event Page Component
export default function EventSlugPage() {
  const { slug } = useParams();
  const router = useRouter();
  const { theme } = useTheme();
  
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

  // Check authentication
  useEffect(() => {
    const checkAuth = () => {
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('token');
        setIsAuthenticated(!!token);
      }
    };
    checkAuth();
  }, []);

  // Fetch event data
  useEffect(() => {
    if (!slug) return;

    const fetchEvent = async () => {
      try {
        setLoading(true);
        const res = await api.get(`/events/slug/${slug}`);
        
        if (res.data?.success) {
          setEvent(res.data.event);
          await fetchRegistrationCount(res.data.event._id);
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

  const fetchRegistrationCount = async (eventId: string) => {
    try {
      const countRes = await api.get(`/registration/responses/${eventId}/count`);
      if (countRes.data.success) {
        setRegistrationCount(countRes.data.count);
      }
    } catch (countErr) {
      console.error("Failed to fetch registration count", countErr);
    }
  };

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
      fetchRegistrationCount(event._id);
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

  // Utility functions
  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (error) {
      return "Invalid Date";
    }
  };

  const formatShortDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch (error) {
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
      return "Invalid Time";
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
      return dateString;
    }
  };

  if (loading) {
    return <EventLoadingSkeleton />;
  }

  if (error) {
    return <EventErrorState error={error} onRetry={() => window.location.reload()} />;
  }

  if (!event) {
    return null;
  }

  const isEventFull = event?.maxAttendees && registrationCount >= event.maxAttendees;
  const isEventPast = event ? new Date(event.endDate) < new Date() : false;

  // Tab Content Components
  const OverviewTab = () => (
    <div className="space-y-6">
      <div>
        <h2 className={`text-2xl font-bold mb-4 ${
          theme === 'dark' ? 'text-white' : 'text-gray-900'
        }`}>
          About This Event
        </h2>
        <p className={`leading-relaxed text-lg ${
          theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
        }`}>
          {event.description}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <InfoItem
            icon={MapPin}
            title="Venue"
            value={event.venue}
            color="green"
          />
          <InfoItem
            icon={Calendar}
            title="Date"
            value={
              formatDate(event.startDate) +
              (event.endDate && event.endDate !== event.startDate 
                ? ` - ${formatDate(event.endDate)}` 
                : "")
            }
            color="blue"
          />
        </div>
        <div className="space-y-4">
          <InfoItem
            icon={Clock}
            title="Time"
            value={
              (event.startTime && formatTime(event.startTime)) +
              (event.endTime ? ` - ${formatTime(event.endTime)}` : "")
            }
            color="purple"
          />
          {event.organizer && (
            <InfoItem
              icon={User}
              title="Organizer"
              value={event.organizer}
              color="orange"
            />
          )}
        </div>
      </div>
    </div>
  );

  const ScheduleTab = () => (
    <div className="space-y-6">
      <h2 className={`text-2xl font-bold mb-6 ${
        theme === 'dark' ? 'text-white' : 'text-gray-900'
      }`}>
        Event Schedule
      </h2>
      {event.schedule && event.schedule.length > 0 ? (
        <div className="space-y-4">
          {event.schedule.map((item, index) => (
            <div 
              key={index}
              className={`rounded-xl p-6 border shadow-sm hover:shadow-md transition-all duration-300 ${
                theme === 'dark'
                  ? 'bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border-blue-500/20'
                  : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200/60'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between">
                <div className="flex-1">
                  <div className="flex items-start space-x-3 mb-3">
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm mt-1">
                      {index + 1}
                    </div>
                    <div>
                      <h3 className={`text-xl font-semibold mb-2 ${
                        theme === 'dark' ? 'text-white' : 'text-gray-900'
                      }`}>
                        {item.title}
                      </h3>
                      <p className={`mb-3 ${
                        theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                      }`}>
                        {item.description}
                      </p>
                      {item.speakers && item.speakers.length > 0 && (
                        <div className={`flex items-center text-sm ${
                          theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                        }`}>
                          <Mic className="h-4 w-4 mr-2 text-purple-500" />
                          Speakers: {item.speakers.join(', ')}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="lg:text-right lg:ml-6 mt-4 lg:mt-0">
                  <div className={`rounded-lg px-4 py-2 shadow-sm ${
                    theme === 'dark' ? 'bg-slate-700' : 'bg-white'
                  }`}>
                    <p className={`font-semibold text-sm ${
                      theme === 'dark' ? 'text-white' : 'text-gray-900'
                    }`}>{item.time}</p>
                    <p className={`text-sm ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>{formatScheduleDate(item.day)}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <Clock3 className={`h-12 w-12 mx-auto mb-4 ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`} />
          <p className={`text-lg ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
          }`}>
            Schedule details coming soon
          </p>
        </div>
      )}
    </div>
  );

  const SpeakersTab = () => (
    <div className="space-y-6">
      <h2 className={`text-2xl font-bold mb-6 ${
        theme === 'dark' ? 'text-white' : 'text-gray-900'
      }`}>
        Featured Speakers
      </h2>
      {event.speakers && event.speakers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {event.speakers.map((speaker, index) => (
            <div 
              key={index}
              className={`rounded-xl p-6 border shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1 ${
                theme === 'dark' 
                  ? 'bg-slate-800/50 border-slate-600' 
                  : 'bg-white border-gray-200'
              }`}
            >
              <div className="flex items-start space-x-4">
                <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                  {speaker.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="flex-1">
                  <h3 className={`text-xl font-bold mb-2 ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>
                    {speaker.name}
                  </h3>
                  <p className={`font-medium mb-1 ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                  }`}>
                    {speaker.designation}
                  </p>
                  {speaker.company && (
                    <p className={`text-sm mb-3 ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                      {speaker.company}
                    </p>
                  )}
                  {speaker.linkedin && (
                    <a
                      href={speaker.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center font-medium text-sm transition-colors ${
                        theme === 'dark' 
                          ? 'text-blue-400 hover:text-blue-300' 
                          : 'text-blue-600 hover:text-blue-800'
                      }`}
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
          <Mic className={`h-12 w-12 mx-auto mb-4 ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`} />
          <p className={`text-lg ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
          }`}>
            Speaker information coming soon
          </p>
        </div>
      )}
    </div>
  );

  const BenefitsTab = () => (
    <div className="space-y-6">
      <h2 className={`text-2xl font-bold mb-6 ${
        theme === 'dark' ? 'text-white' : 'text-gray-900'
      }`}>
        What You'll Gain
      </h2>
      {event.benefits && event.benefits.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {event.benefits.map((benefit, index) => (
            <div 
              key={index}
              className={`rounded-xl p-6 border shadow-sm hover:shadow-md transition-all duration-300 ${
                theme === 'dark'
                  ? 'bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-green-500/20'
                  : 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200/60'
              }`}
            >
              <div className="flex items-center space-x-3">
                <Gift className="h-6 w-6 text-green-600 flex-shrink-0" />
                <p className={`font-medium ${
                  theme === 'dark' ? 'text-gray-200' : 'text-gray-800'
                }`}>
                  {benefit}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <Gift className={`h-12 w-12 mx-auto mb-4 ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`} />
          <p className={`text-lg ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
          }`}>
            Benefits information coming soon
          </p>
        </div>
      )}
    </div>
  );

  const PartnersTab = () => (
    <div className="space-y-6">
      <h2 className={`text-2xl font-bold mb-6 ${
        theme === 'dark' ? 'text-white' : 'text-gray-900'
      }`}>
        Event Partners
      </h2>
      {event.partners && event.partners.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {event.partners.map((partner, index) => (
            <div 
              key={index}
              className={`rounded-xl p-6 border shadow-sm hover:shadow-md transition-all duration-300 text-center ${
                theme === 'dark' 
                  ? 'bg-slate-800/50 border-slate-600' 
                  : 'bg-white border-gray-200'
              }`}
            >
              <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg mx-auto mb-4">
                {partner.name.split(' ').map(n => n[0]).join('')}
              </div>
              <h3 className={`text-lg font-bold mb-2 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>
                {partner.name}
              </h3>
              <p className={`font-medium mb-3 ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
              }`}>
                {partner.role}
              </p>
              {partner.website && (
                <a
                  href={partner.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center font-medium text-sm ${
                    theme === 'dark' 
                      ? 'text-blue-400 hover:text-blue-300' 
                      : 'text-blue-600 hover:text-blue-800'
                  }`}
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
          <Handshake className={`h-12 w-12 mx-auto mb-4 ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`} />
          <p className={`text-lg ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
          }`}>
            Partner information coming soon
          </p>
        </div>
      )}
    </div>
  );

  const LocationTab = () => (
    <div className="space-y-6">
      <h2 className={`text-2xl font-bold mb-6 ${
        theme === 'dark' ? 'text-white' : 'text-gray-900'
      }`}>
        Event Location
      </h2>
      <div className="space-y-4">
        <div className={`rounded-xl p-6 border shadow-sm ${
          theme === 'dark' 
            ? 'bg-slate-800/50 border-slate-600' 
            : 'bg-white border-gray-200'
        }`}>
          <h3 className={`text-lg font-semibold mb-3 flex items-center ${
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          }`}>
            <MapPin className="h-5 w-5 text-green-600 mr-2" />
            Venue Address
          </h3>
          <p className={`text-lg ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
          }`}>
            {event.venue}
          </p>
        </div>
        
        {event.venueIframeLink && (
          <div className={`rounded-xl p-6 border shadow-sm ${
            theme === 'dark' 
              ? 'bg-slate-800/50 border-slate-600' 
              : 'bg-white border-gray-200'
          }`}>
            <h3 className={`text-lg font-semibold mb-4 flex items-center ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}>
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
  );

  // Helper component for info items
  const InfoItem = ({ icon: Icon, title, value, color }: { 
    icon: React.ComponentType<any>;
    title: string;
    value: string;
    color: "green" | "blue" | "purple" | "orange";
  }) => {
    const colorClasses = {
      green: theme === 'dark' ? 'text-green-400' : 'text-green-500',
      blue: theme === 'dark' ? 'text-blue-400' : 'text-blue-500',
      purple: theme === 'dark' ? 'text-purple-400' : 'text-purple-500',
      orange: theme === 'dark' ? 'text-orange-400' : 'text-orange-500',
    };

    return (
      <div className="flex items-start space-x-3">
        <Icon className={`h-5 w-5 mt-1 flex-shrink-0 ${colorClasses[color]}`} />
        <div>
          <p className={`font-semibold ${
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          }`}>
            {title}
          </p>
          <p className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
            {value}
          </p>
        </div>
      </div>
    );
  };

  // Stat Card Component
  const StatCard = ({ icon: Icon, value, label, subtitle, color }: {
    icon: React.ComponentType<any>;
    value: string;
    label: string;
    subtitle?: string;
    color: "blue" | "green" | "purple" | "orange";
  }) => {
    const colorClasses = {
      blue: { icon: "text-blue-600", bg: "from-blue-50 to-blue-100" },
      green: { icon: "text-green-600", bg: "from-green-50 to-green-100" },
      purple: { icon: "text-purple-600", bg: "from-purple-50 to-purple-100" },
      orange: { icon: "text-orange-600", bg: "from-orange-50 to-orange-100" },
    };

    const darkColorClasses = {
      blue: { icon: "text-blue-400", bg: "from-blue-500/10 to-blue-600/10" },
      green: { icon: "text-green-400", bg: "from-green-500/10 to-green-600/10" },
      purple: { icon: "text-purple-400", bg: "from-purple-500/10 to-purple-600/10" },
      orange: { icon: "text-orange-400", bg: "from-orange-500/10 to-orange-600/10" },
    };

    const colors = theme === 'dark' ? darkColorClasses[color] : colorClasses[color];

    return (
      <div className={`bg-gradient-to-br rounded-xl p-4 text-center border shadow-lg hover:shadow-xl transition-all duration-300 backdrop-blur-sm ${
        theme === 'dark'
          ? `${colors.bg} border-slate-700`
          : `${colors.bg} border-gray-200/60`
      }`}>
        <Icon className={`h-6 w-6 mx-auto mb-2 ${colors.icon}`} />
        <p className={`text-2xl font-bold mb-1 ${
          theme === 'dark' ? 'text-white' : 'text-gray-900'
        }`}>
          {value}
        </p>
        <p className={`text-xs ${
          theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
        }`}>
          {label}
        </p>
        {subtitle && (
          <p className={`text-xs mt-1 ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
          }`}>
            {subtitle}
          </p>
        )}
      </div>
    );
  };

  const tabs = [
    { id: "overview", label: "Overview", component: OverviewTab },
    { id: "schedule", label: "Schedule", component: ScheduleTab },
    { id: "speakers", label: "Speakers", component: SpeakersTab },
    { id: "benefits", label: "Benefits", component: BenefitsTab },
    { id: "partners", label: "Partners", component: PartnersTab },
    { id: "location", label: "Location", component: LocationTab },
  ];

  const ActiveTabComponent = tabs.find(tab => tab.id === activeTab)?.component || OverviewTab;

  return (
    <div className={`min-h-screen transition-colors duration-300 ${
      theme === 'dark'
        ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white'
        : 'bg-white text-gray-900'
    }`}>
      
      {/* Theme Toggle */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      {/* Header */}
      <div className={`transition-colors duration-300 ${
        theme === 'dark' 
          ? 'bg-gradient-to-r from-blue-600/20 via-purple-600/20 to-indigo-700/20' 
          : 'bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 text-white'
      } shadow-2xl`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => router.push('/events')}
              className={`backdrop-blur-sm ${
                theme === 'dark'
                  ? 'bg-slate-800/60 border-slate-600 text-white hover:bg-slate-700/60'
                  : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
              }`}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Events
            </Button>
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={shareEvent}
                className={`backdrop-blur-sm ${
                  theme === 'dark'
                    ? 'bg-slate-800/60 border-slate-600 text-white hover:bg-slate-700/60'
                    : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                }`}
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
                    ? theme === 'dark'
                      ? 'bg-yellow-500/20 text-yellow-200 border-yellow-300/30' 
                      : 'bg-yellow-500/20 text-yellow-200 border-yellow-300/30'
                    : theme === 'dark'
                      ? 'bg-slate-800/60 border-slate-600 text-white hover:bg-slate-700/60'
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
          
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* Event Image */}
            <div className="relative group">
              {event.bannerUrl ? (
                <div className="relative overflow-hidden rounded-2xl shadow-2xl">
                  <EventImage
                    src={event.bannerUrl}
                    alt={event.title}
                    className="w-full h-64 lg:h-96 object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </div>
              ) : (
                <EventImage
                  src=""
                  alt={event.title}
                  className="w-full h-64 lg:h-96"
                />
              )}
              
              {/* Badges */}
              <div className="absolute top-4 left-4 flex flex-wrap gap-2">
                {event.category && (
                  <Badge className={`backdrop-blur-sm border-0 shadow-lg px-3 py-2 font-semibold ${
                    theme === 'dark'
                      ? 'bg-white/20 text-white'
                      : 'bg-white/90 text-gray-800'
                  }`}>
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
              <StatCard
                icon={Users}
                value={registrationCount.toString()}
                label="Registered"
                subtitle={event.maxAttendees ? `of ${event.maxAttendees} total` : undefined}
                color="blue"
              />
              <StatCard
                icon={Calendar}
                value={formatShortDate(event.startDate)}
                label="Date"
                color="green"
              />
              <StatCard
                icon={MapPin}
                value={event.venue.split(',')[0]}
                label="Venue"
                color="purple"
              />
              <StatCard
                icon={Ticket}
                value={event.price === 0 ? 'Free' : `$${event.price}`}
                label="Price"
                color="orange"
              />
            </div>

            {/* Tabs Section */}
            <div className={`rounded-2xl border shadow-lg backdrop-blur-sm ${
              theme === 'dark'
                ? 'bg-slate-800/30 border-slate-700'
                : 'bg-white/70 border-gray-200/60'
            }`}>
              
              {/* Tab Navigation */}
              <div className={`flex overflow-x-auto border-b ${
                theme === 'dark' ? 'border-slate-700' : 'border-gray-200/60'
              }`}>
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 px-6 py-4 text-sm font-medium transition-all duration-200 ${
                      activeTab === tab.id
                        ? theme === 'dark'
                          ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/10'
                          : 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                        : theme === 'dark'
                          ? 'text-gray-400 hover:text-gray-300 hover:bg-slate-700/50'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50/50'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="p-6">
                <ActiveTabComponent />
              </div>
            </div>
          </div>

          {/* Right Column - Sidebar */}
          <div className="space-y-6">
            {/* Registration Card */}
            <div className={`rounded-2xl border shadow-xl p-6 sticky top-6 backdrop-blur-sm ${
              theme === 'dark'
                ? 'bg-slate-800/30 border-slate-700'
                : 'bg-white/70 border-gray-200/60'
            }`}>
              
              <div className="text-center mb-6">
                <h3 className={`text-2xl font-bold mb-2 ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  Join This Event
                </h3>
                <div className={`w-16 h-1 bg-gradient-to-r from-blue-500 to-purple-600 mx-auto rounded-full ${
                  theme === 'dark' ? 'opacity-80' : ''
                }`}></div>
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
                      onClick={handleRegisterClick}
                      disabled={isEventFull || isEventPast}
                      className="w-full px-6 py-4 text-lg font-semibold rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isEventPast ? 'Event Ended' : isEventFull ? 'Event Full' : 'Register Now'}
                    </Button>
                  )}
                  
                  {isEventFull && !isEventPast && (
                    <div className={`rounded-xl p-4 ${
                      theme === 'dark' 
                        ? 'bg-orange-500/10 border border-orange-500/20' 
                        : 'bg-orange-50 border border-orange-200'
                    }`}>
                      <p className={`text-sm font-medium text-center ${
                        theme === 'dark' ? 'text-orange-300' : 'text-orange-800'
                      }`}>
                        <AlertCircle className="h-4 w-4 inline mr-1" />
                        This event has reached maximum capacity
                      </p>
                    </div>
                  )}

                  {event.price !== undefined && event.price > 0 && (
                    <div className={`rounded-xl p-4 ${
                      theme === 'dark'
                        ? 'bg-blue-500/10 border border-blue-500/20'
                        : 'bg-blue-50 border border-blue-200'
                    }`}>
                      <p className={`text-sm font-semibold text-center ${
                        theme === 'dark' ? 'text-blue-300' : 'text-blue-800'
                      }`}>
                        <Crown className="h-4 w-4 inline mr-1" />
                        Price: ${event.price}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className={`rounded-xl p-6 ${
                    theme === 'dark'
                      ? 'bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20'
                      : 'bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200'
                  }`}>
                    <p className={`font-semibold flex items-center justify-center text-lg mb-4 ${
                      theme === 'dark' ? 'text-green-300' : 'text-green-800'
                    }`}>
                      <CheckCircle className="h-6 w-6 mr-2" />
                      You're Registered!
                    </p>
                    <div className="space-y-3">
                      <Button 
                        onClick={handleViewTicket}
                        className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 transition-all duration-200 shadow-lg hover:shadow-xl text-white"
                      >
                        <QrCode className="h-5 w-5 mr-2" />
                        View Your Ticket
                      </Button>
                      <Button 
                        onClick={() => router.push('/user/profile?tab=tickets')}
                        variant="outline"
                        className={`w-full border-2 transition-all duration-200 ${
                          theme === 'dark'
                            ? 'border-green-400 text-green-300 hover:bg-green-500/20'
                            : 'border-green-300 text-green-700 hover:bg-green-100'
                        }`}
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
                    className={`inline-flex items-center justify-center w-full px-4 py-3 border text-base font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow-md ${
                      theme === 'dark'
                        ? 'border-green-600 text-green-400 bg-green-500/10 hover:bg-green-500/20'
                        : 'border-green-600 text-green-600 bg-white hover:bg-green-50'
                    }`}
                  >
                    Join WhatsApp Group
                    <ExternalLink className="h-4 w-4 ml-2" />
                  </a>
                )}
                
                {/* Capacity Progress */}
                {event.maxAttendees && (
                  <div className={`rounded-xl p-4 ${
                    theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-50'
                  }`}>
                    <div className="flex justify-between text-sm font-medium mb-2">
                      <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>
                        Capacity
                      </span>
                      <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>
                        {registrationCount} / {event.maxAttendees}
                      </span>
                    </div>
                    <div className={`w-full rounded-full h-2 ${
                      theme === 'dark' ? 'bg-slate-600' : 'bg-gray-200'
                    }`}>
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
          </div>
        </div>
      </div>

      {/* Modals */}
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

      <TicketModal 
        ticket={userTicket}
        isOpen={showTicketModal}
        onClose={() => setShowTicketModal(false)}
      />
    </div>
  );
}