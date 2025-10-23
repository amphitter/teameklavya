"use client";

import { useState, useEffect, JSX } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar,
  MapPin,
  Clock,
  User,
  ArrowLeft,
  ExternalLink,
  Download,
  FileText,
  Filter,
  Search,
  AlertCircle,
  CheckCircle,
  XCircle,
  ChevronDown,
  BarChart3,
  TrendingUp,
  Users,
  QrCode,
  Ticket
} from "lucide-react";
import { toast } from "sonner";

interface Event {
  _id: string;
  title: string;
  slug: string;
  bannerUrl?: string;
  startDate: string;
  endDate: string;
  venue: string;
  description?: string;
  category?: string;
  organizer?: string;
}

interface Registration {
  _id: string;
  eventId: Event;
  userId: string;
  status: 'registered' | 'cancelled' | 'attended' | 'no_show';
  registrationDate: string;
  attendedAt?: string;
  cancelledAt?: string;
  profileData?: {
    institution?: string;
    course?: string;
    year?: string;
  };
  ticket?: {
    _id: string;
    qrCode: string;
    token: string;
    checkedIn: boolean;
    checkInTime?: string;
  };
}

interface RegistrationStats {
  total: number;
  upcoming: number;
  attended: number;
  cancelled: number;
}

export default function RegistrationsPage() {
  const router = useRouter();
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<RegistrationStats>({
    total: 0,
    upcoming: 0,
    attended: 0,
    cancelled: 0
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");

  useEffect(() => {
    fetchRegistrations();
  }, []);

  const fetchRegistrations = async () => {
    try {
      setLoading(true);
      setError(null);

      // Try multiple endpoints to get user registrations
      const endpoints = [
        "/registration/user/events",
        "/registration/my-registrations", 
        "/registration/user/registrations",
        "/tickets/my-tickets"
      ];

      let fetchedRegistrations: Registration[] = [];
      let fetchedTickets: any[] = [];

      // Try to get registrations from various endpoints
      for (const endpoint of endpoints.slice(0, 3)) {
        try {
          const response = await api.get(endpoint);
          
          if (response.data.registrations && Array.isArray(response.data.registrations)) {
            fetchedRegistrations = response.data.registrations;
            break;
          } else if (response.data.events && Array.isArray(response.data.events)) {
            // Convert events to registration format
            fetchedRegistrations = response.data.events.map((event: Event) => ({
              _id: `reg_${event._id}`,
              eventId: event,
              userId: "current",
              status: 'registered' as const,
              registrationDate: new Date().toISOString(),
              profileData: {}
            }));
            break;
          } else if (Array.isArray(response.data)) {
            fetchedRegistrations = response.data.map((item: any) => ({
              _id: item._id || `reg_${item.eventId?._id || Math.random()}`,
              eventId: item.eventId || item,
              userId: item.userId || "current",
              status: item.status || 'registered',
              registrationDate: item.registrationDate || new Date().toISOString(),
              attendedAt: item.attendedAt,
              cancelledAt: item.cancelledAt,
              profileData: item.profileData || {}
            }));
            break;
          }
        } catch (err) {
          continue;
        }
      }

      // Get tickets for merging
      try {
        const ticketsRes = await api.get("/tickets/user-tickets");
        fetchedTickets = ticketsRes.data.tickets || ticketsRes.data || [];
      } catch (err) {
        // Continue without tickets if endpoint fails
      }

      // If no registrations found via registration endpoints, try to create from tickets
      if (fetchedRegistrations.length === 0 && fetchedTickets.length > 0) {
        fetchedRegistrations = fetchedTickets.map((ticket: any) => ({
          _id: `reg_from_ticket_${ticket._id}`,
          eventId: ticket.eventId,
          userId: "current",
          status: ticket.checkedIn ? 'attended' : 'registered',
          registrationDate: ticket.createdAt || new Date().toISOString(),
          attendedAt: ticket.checkInTime,
          profileData: {},
          ticket: ticket
        }));
      }

      // Merge ticket data with registrations
      if (fetchedTickets.length > 0) {
        fetchedRegistrations = fetchedRegistrations.map(reg => {
          const ticket = fetchedTickets.find((t: any) => 
            t.eventId?._id === reg.eventId._id || 
            t.eventId === reg.eventId._id
          );
          return {
            ...reg,
            ticket: ticket || reg.ticket
          };
        });
      }

      setRegistrations(fetchedRegistrations);
      calculateStats(fetchedRegistrations);

    } catch (err: any) {
      const errorMessage = err.response?.data?.message || "Failed to load registration history";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (regs: Registration[]) => {
    const now = new Date();
    const upcoming = regs.filter(reg => 
      reg.status === 'registered' && new Date(reg.eventId.startDate) > now
    );
    const attended = regs.filter(reg => reg.status === 'attended' || reg.ticket?.checkedIn);
    const cancelled = regs.filter(reg => reg.status === 'cancelled');

    setStats({
      total: regs.length,
      upcoming: upcoming.length,
      attended: attended.length,
      cancelled: cancelled.length
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (registration: Registration) => {
    const now = new Date();
    const eventDate = new Date(registration.eventId.startDate);
    
    if (registration.status === 'cancelled') {
      return (
        <Badge variant="destructive" className="px-3 py-1.5 font-semibold">
          <XCircle className="h-3 w-3 mr-1" />
          Cancelled
        </Badge>
      );
    }
    
    if (registration.status === 'attended' || registration.ticket?.checkedIn) {
      return (
        <Badge variant="success" className="px-3 py-1.5 font-semibold">
          <CheckCircle className="h-3 w-3 mr-1" />
          Attended
        </Badge>
      );
    }
    
    if (registration.status === 'no_show') {
      return (
        <Badge variant="destructive" className="px-3 py-1.5 font-semibold">
          <XCircle className="h-3 w-3 mr-1" />
          No Show
        </Badge>
      );
    }
    
    if (eventDate < now) {
      return (
        <Badge variant="outline" className="px-3 py-1.5 font-semibold bg-gray-100 text-gray-700 border-gray-300">
          <Clock className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      );
    }
    
    return (
      <Badge variant="default" className="px-3 py-1.5 font-semibold bg-blue-100 text-blue-700 border-blue-200">
        <Calendar className="h-3 w-3 mr-1" />
        Registered
      </Badge>
    );
  };

  const getImageUrl = (imagePath: string | undefined) => {
    if (!imagePath) return '/api/placeholder/400/200';
    if (imagePath.startsWith('http')) return imagePath;
    if (imagePath.startsWith('/uploads')) {
      const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      return `${baseURL}${imagePath}`;
    }
    return imagePath;
  };

  const filteredRegistrations = registrations.filter(registration => {
    // Search filter
    const matchesSearch = searchTerm === "" || 
      registration.eventId.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      registration.eventId.venue.toLowerCase().includes(searchTerm.toLowerCase()) ||
      registration.eventId.category?.toLowerCase().includes(searchTerm.toLowerCase());

    // Status filter
    const now = new Date();
    const eventDate = new Date(registration.eventId.startDate);
    let matchesStatus = true;
    
    switch (statusFilter) {
      case "upcoming":
        matchesStatus = registration.status === 'registered' && eventDate > now;
        break;
      case "past":
        matchesStatus = registration.status === 'registered' && eventDate <= now;
        break;
      case "attended":
        matchesStatus = registration.status === 'attended' || Boolean(registration.ticket?.checkedIn);
        break;
      case "cancelled":
        matchesStatus = registration.status === 'cancelled';
        break;
      default:
        matchesStatus = true;
    }

    // Date filter
    const matchesDate = dateFilter === "all" || filterByDate(registration, dateFilter);

    return matchesSearch && matchesStatus && matchesDate;
  });

  const filterByDate = (registration: Registration, filter: string) => {
    const now = new Date();
    const eventDate = new Date(registration.eventId.startDate);
    
    switch (filter) {
      case "this_month":
        return eventDate.getMonth() === now.getMonth() && eventDate.getFullYear() === now.getFullYear();
      case "last_month":
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return eventDate.getMonth() === lastMonth.getMonth() && eventDate.getFullYear() === lastMonth.getFullYear();
      case "last_3_months":
        const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        return eventDate >= threeMonthsAgo;
      case "this_year":
        return eventDate.getFullYear() === now.getFullYear();
      default:
        return true;
    }
  };

  const exportRegistrations = () => {
    try {
      const data = filteredRegistrations.map(reg => ({
        Event: reg.eventId.title,
        Date: formatDate(reg.eventId.startDate),
        Venue: reg.eventId.venue,
        Status: reg.status,
        'Registration Date': formatDate(reg.registrationDate),
        Category: reg.eventId.category || 'N/A',
        Institution: reg.profileData?.institution || 'N/A',
        Course: reg.profileData?.course || 'N/A',
        Year: reg.profileData?.year || 'N/A'
      }));

      if (data.length === 0) {
        toast.error("No data to export");
        return;
      }

      const csvHeaders = Object.keys(data[0]).join(',');
      const csvRows = data.map(row => Object.values(row).map(value => `"${value}"`).join(','));
      const csvContent = [csvHeaders, ...csvRows].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `event-registrations-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success("Registrations exported successfully!");
    } catch (error) {
      toast.error("Failed to export registrations");
    }
  };

  const downloadTicket = async (ticket: any) => {
    if (!ticket) {
      toast.error("No ticket available for this registration");
      return;
    }

    try {
      const link = document.createElement('a');
      link.href = ticket.qrCode;
      link.download = `ticket-${ticket.eventId?.title || 'event'}-${ticket.token}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Ticket downloaded successfully!");
    } catch (error) {
      toast.error("Failed to download ticket");
    }
  };

  const viewTicket = (ticket: any) => {
    if (!ticket) {
      toast.error("No ticket available for this registration");
      return;
    }
    
    window.open(ticket.qrCode, '_blank');
  };

  if (loading) {
    return <RegistrationsSkeleton />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute inset-0 bg-black/10"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center space-x-4 mb-6 lg:mb-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/user/dashboard')}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
              <div className="space-y-2">
                <h1 className="text-3xl lg:text-4xl font-bold bg-gradient-to-r from-white to-blue-100 bg-clip-text text-transparent">
                  My Registrations
                </h1>
                <p className="text-blue-100 font-medium">Complete history of all your event registrations</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                onClick={exportRegistrations}
                disabled={filteredRegistrations.length === 0}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
              <Button asChild className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm transition-all duration-200 shadow-lg hover:shadow-xl">
                <Link href="/events">
                  <Calendar className="h-4 w-4 mr-2" />
                  Browse Events
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-600 mb-1">Total Registrations</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                  <p className="text-xs text-gray-500 mt-1">All events</p>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 p-3 shadow-lg">
                  <FileText className="h-6 w-6 text-white" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm text-blue-600 font-medium">
                <BarChart3 className="h-4 w-4 mr-1" />
                <span>All your events</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-600 mb-1">Upcoming</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.upcoming}</p>
                  <p className="text-xs text-gray-500 mt-1">Future events</p>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 p-3 shadow-lg">
                  <Clock className="h-6 w-6 text-white" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm text-green-600 font-medium">
                <TrendingUp className="h-4 w-4 mr-1" />
                <span>Ready to attend</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-600 mb-1">Attended</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.attended}</p>
                  <p className="text-xs text-gray-500 mt-1">Completed events</p>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 p-3 shadow-lg">
                  <CheckCircle className="h-6 w-6 text-white" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm text-purple-600 font-medium">
                <Users className="h-4 w-4 mr-1" />
                <span>Successfully attended</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-600 mb-1">Cancelled</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.cancelled}</p>
                  <p className="text-xs text-gray-500 mt-1">Cancelled events</p>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-red-500 to-orange-600 p-3 shadow-lg">
                  <XCircle className="h-6 w-6 text-white" />
                </div>
              </div>
              <div className="mt-4 flex items-center text-sm text-red-600 font-medium">
                <XCircle className="h-4 w-4 mr-1" />
                <span>Cancelled registrations</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl mb-8 animate-in slide-in-from-top duration-500">
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-6 lg:space-y-0">
              <div className="flex flex-col sm:flex-row gap-4">
                {/* Search */}
                <div className="relative flex-1 sm:flex-initial">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search events..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-12 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full sm:w-64 bg-white/50 transition-all duration-200"
                  />
                </div>

                {/* Status Filter */}
                <div className="relative">
                  <Filter className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="pl-12 pr-10 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/50 transition-all duration-200 appearance-none cursor-pointer"
                  >
                    <option value="all">All Status</option>
                    <option value="upcoming">Upcoming</option>
                    <option value="past">Past Events</option>
                    <option value="attended">Attended</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                </div>

                {/* Date Filter */}
                <div className="relative">
                  <Calendar className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="pl-12 pr-10 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/50 transition-all duration-200 appearance-none cursor-pointer"
                  >
                    <option value="all">All Time</option>
                    <option value="this_month">This Month</option>
                    <option value="last_month">Last Month</option>
                    <option value="last_3_months">Last 3 Months</option>
                    <option value="this_year">This Year</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              <div className="text-sm font-semibold text-gray-600 bg-white/50 px-4 py-2 rounded-xl border border-gray-200">
                Showing {filteredRegistrations.length} of {registrations.length} registrations
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error State */}
        {error && (
          <Card className="border border-red-200 bg-gradient-to-r from-red-50 to-orange-50 shadow-lg rounded-2xl mb-8 animate-in slide-in-from-top duration-500">
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <h3 className="text-xl font-semibold text-red-800 mb-3">Unable to Load Registrations</h3>
              <p className="text-red-700 mb-6">{error}</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button 
                  onClick={fetchRegistrations} 
                  variant="outline" 
                  className="border-red-300 text-red-700 hover:bg-red-100 transition-all duration-200"
                >
                  Try Again
                </Button>
                <Button 
                  asChild
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200"
                >
                  <Link href="/events">
                    Browse Events
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Registrations List */}
        {!error && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {filteredRegistrations.length === 0 ? (
              <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl text-center animate-in zoom-in duration-500">
                <CardContent className="py-16">
                  <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Calendar className="h-10 w-10 text-gray-400" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-3">
                    {registrations.length === 0 ? "No Registrations Yet" : "No Matching Registrations"}
                  </h3>
                  <p className="text-gray-600 mb-8 max-w-md mx-auto leading-relaxed">
                    {registrations.length === 0 
                      ? "You haven't registered for any events yet. Start exploring events to get started!"
                      : "Try adjusting your search criteria or filters to find what you're looking for."
                    }
                  </p>
                  <Button 
                    asChild
                    className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl text-lg px-8 py-3 rounded-xl"
                  >
                    <Link href="/events">
                      <Calendar className="h-5 w-5 mr-2" />
                      Browse Events
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              filteredRegistrations.map((registration, index) => (
                <RegistrationCard
                  key={registration._id}
                  registration={registration}
                  formatDate={formatDate}
                  formatTime={formatTime}
                  getImageUrl={getImageUrl}
                  getStatusBadge={getStatusBadge}
                  onDownloadTicket={downloadTicket}
                  onViewTicket={viewTicket}
                  delay={index * 100}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Enhanced Registration Card Component with Animations
function RegistrationCard({ 
  registration, 
  formatDate, 
  formatTime, 
  getImageUrl, 
  getStatusBadge,
  onDownloadTicket,
  onViewTicket,
  delay = 0
}: {
  registration: Registration;
  formatDate: (date: string) => string;
  formatTime: (date: string) => string;
  getImageUrl: (imagePath: string | undefined) => string;
  getStatusBadge: (reg: Registration) => JSX.Element;
  onDownloadTicket: (ticket: any) => void;
  onViewTicket: (ticket: any) => void;
  delay?: number;
}) {
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);

  const handleEventClick = () => {
    if (registration.eventId.slug) {
      router.push(`/events/${registration.eventId.slug}`);
    } else {
      toast.error("Event details not available");
    }
  };

  const isUpcoming = registration.status === 'registered' && new Date(registration.eventId.startDate) > new Date();

  return (
    <Card 
      className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 animate-in slide-in-from-bottom duration-500"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="p-6">
        <div className="flex flex-col lg:flex-row lg:items-start gap-6">
          {/* Event Image */}
          <div 
            className="lg:w-48 h-40 rounded-xl overflow-hidden cursor-pointer flex-shrink-0 group relative"
            onClick={handleEventClick}
          >
            <img 
              src={getImageUrl(registration.eventId.bannerUrl)} 
              alt={registration.eventId.title}
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = '/api/placeholder/400/200';
              }}
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-300"></div>
            {registration.ticket && (
              <div className="absolute top-2 right-2">
                <Badge className="bg-green-500 hover:bg-green-600">
                  <Ticket className="h-3 w-3 mr-1" />
                  Ticket
                </Badge>
              </div>
            )}
          </div>

          {/* Event Details */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-4">
              <div className="flex-1">
                <h3 
                  className="text-2xl font-bold text-gray-900 mb-3 hover:text-blue-600 cursor-pointer transition-colors line-clamp-2"
                  onClick={handleEventClick}
                >
                  {registration.eventId.title}
                </h3>
                
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 mb-4">
                  <div className="flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-2">
                    <Calendar className="h-4 w-4 text-blue-500" />
                    <span className="font-medium">{formatDate(registration.eventId.startDate)}</span>
                    {registration.eventId.endDate && registration.eventId.endDate !== registration.eventId.startDate && (
                      <span className="text-gray-400">to {formatDate(registration.eventId.endDate)}</span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-2">
                    <MapPin className="h-4 w-4 text-green-500" />
                    <span className="font-medium max-w-xs truncate">{registration.eventId.venue}</span>
                  </div>
                  {registration.eventId.category && (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 px-3 py-1 font-semibold">
                      {registration.eventId.category}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3 sm:ml-4 mt-4 sm:mt-0">
                {getStatusBadge(registration)}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDetails(!showDetails)}
                  className="h-10 w-10 p-0 bg-white shadow-md hover:shadow-lg transition-all duration-200 rounded-xl"
                >
                  <ChevronDown className={`h-5 w-5 transition-transform duration-300 ${showDetails ? 'rotate-180' : ''}`} />
                </Button>
              </div>
            </div>

            {/* Registration Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600 mb-4">
              <div className="flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-2">
                <span className="font-semibold text-gray-700">Registered on:</span>
                <span>{formatDate(registration.registrationDate)}</span>
              </div>
              <div className="flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-2">
                <span className="font-semibold text-gray-700">Registration ID:</span>
                <span className="font-mono">{registration._id.slice(-8)}</span>
              </div>
              {registration.attendedAt && (
                <div className="flex items-center space-x-2 bg-green-50 rounded-lg px-3 py-2">
                  <span className="font-semibold text-green-700">Attended at:</span>
                  <span>{formatTime(registration.attendedAt)}</span>
                </div>
              )}
              {registration.cancelledAt && (
                <div className="flex items-center space-x-2 bg-red-50 rounded-lg px-3 py-2">
                  <span className="font-semibold text-red-700">Cancelled on:</span>
                  <span>{formatDate(registration.cancelledAt)}</span>
                </div>
              )}
            </div>

            {/* Event Description */}
            {registration.eventId.description && (
              <div className="mb-4">
                <p className="text-gray-600 text-sm line-clamp-2">
                  {registration.eventId.description}
                </p>
              </div>
            )}

            {/* Profile Data */}
            {showDetails && registration.profileData && (
              <div className="mt-4 p-4 bg-gradient-to-br from-gray-50 to-blue-50 rounded-xl border border-gray-200 animate-in slide-in-from-top duration-300">
                <h4 className="font-bold text-gray-900 mb-3 flex items-center">
                  <User className="h-4 w-4 mr-2 text-blue-600" />
                  Registration Details
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  {registration.profileData.institution && (
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <span className="font-semibold text-gray-700">Institution:</span>
                      <p className="text-gray-900 mt-1">{registration.profileData.institution}</p>
                    </div>
                  )}
                  {registration.profileData.course && (
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <span className="font-semibold text-gray-700">Course:</span>
                      <p className="text-gray-900 mt-1">{registration.profileData.course}</p>
                    </div>
                  )}
                  {registration.profileData.year && (
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <span className="font-semibold text-gray-700">Year:</span>
                      <p className="text-gray-900 mt-1">{registration.profileData.year}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3 mt-6">
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleEventClick}
                className="border-2 hover:border-blue-300 transition-all duration-200 rounded-xl"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Event
              </Button>
              
              {isUpcoming && registration.ticket && (
                <>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => onDownloadTicket(registration.ticket)}
                    className="border-2 hover:border-green-300 transition-all duration-200 rounded-xl"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Ticket
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => onViewTicket(registration.ticket)}
                    className="border-2 hover:border-purple-300 transition-all duration-200 rounded-xl"
                  >
                    <QrCode className="h-4 w-4 mr-2" />
                    View Ticket
                  </Button>
                </>
              )}

              {registration.ticket?.checkedIn && (
                <Badge variant="success" className="inline-flex items-center px-3 py-2 rounded-xl font-semibold">
                  <CheckCircle className="h-4 w-4 mr-1" />
                  Checked In
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Enhanced Skeleton Loading Component
function RegistrationsSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header Skeleton */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center space-x-4 mb-6 lg:mb-0">
              <Skeleton className="h-10 w-10 rounded-lg bg-white/20" />
              <div className="space-y-3">
                <Skeleton className="h-8 w-48 bg-white/20" />
                <Skeleton className="h-4 w-64 bg-white/20" />
              </div>
            </div>
            <div className="flex space-x-3">
              <Skeleton className="h-10 w-32 rounded-lg bg-white/20" />
              <Skeleton className="h-10 w-32 rounded-lg bg-white/20" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="border border-gray-200 bg-white/70 backdrop-blur-sm rounded-2xl">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-20 bg-gray-200/50" />
                    <Skeleton className="h-8 w-16 bg-gray-200/50" />
                    <Skeleton className="h-3 w-24 bg-gray-200/50" />
                  </div>
                  <Skeleton className="h-12 w-12 rounded-2xl bg-gray-200/50" />
                </div>
                <Skeleton className="h-4 w-32 bg-gray-200/50 mt-4" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters Skeleton */}
        <Card className="border border-gray-200 bg-white/70 backdrop-blur-sm rounded-2xl mb-8">
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-6 lg:space-y-0">
              <div className="flex flex-col sm:flex-row gap-4">
                <Skeleton className="h-12 w-64 rounded-xl bg-gray-200/50" />
                <Skeleton className="h-12 w-40 rounded-xl bg-gray-200/50" />
                <Skeleton className="h-12 w-40 rounded-xl bg-gray-200/50" />
              </div>
              <Skeleton className="h-8 w-48 rounded-xl bg-gray-200/50" />
            </div>
          </CardContent>
        </Card>

        {/* Registrations Skeleton */}
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border border-gray-200 bg-white/70 backdrop-blur-sm rounded-2xl">
              <CardContent className="p-6">
                <div className="flex flex-col lg:flex-row lg:items-start gap-6">
                  <Skeleton className="lg:w-48 h-40 rounded-xl bg-gray-200/50 flex-shrink-0" />
                  <div className="flex-1 space-y-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 space-y-3">
                        <Skeleton className="h-8 w-3/4 bg-gray-200/50" />
                        <div className="flex flex-wrap gap-3">
                          <Skeleton className="h-8 w-32 bg-gray-200/50 rounded-lg" />
                          <Skeleton className="h-8 w-40 bg-gray-200/50 rounded-lg" />
                          <Skeleton className="h-8 w-24 bg-gray-200/50 rounded-lg" />
                        </div>
                      </div>
                      <Skeleton className="h-8 w-24 bg-gray-200/50 rounded-lg" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Skeleton className="h-10 w-full bg-gray-200/50 rounded-lg" />
                      <Skeleton className="h-10 w-full bg-gray-200/50 rounded-lg" />
                    </div>
                    <div className="flex gap-3">
                      <Skeleton className="h-10 w-28 bg-gray-200/50 rounded-xl" />
                      <Skeleton className="h-10 w-36 bg-gray-200/50 rounded-xl" />
                      <Skeleton className="h-10 w-32 bg-gray-200/50 rounded-xl" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}