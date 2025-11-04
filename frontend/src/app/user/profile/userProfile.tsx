"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { 
  User, 
  Calendar, 
  Ticket, 
  Settings, 
  MapPin, 
  Clock,
  ArrowRight,
  QrCode,
  CheckCircle,
  XCircle,
  Edit,
  Shield,
  AlertCircle,
  ExternalLink,
  Download,
  X,
  Copy,
  BarChart3,
  TrendingUp,
  Users,
  FileText,
  Sparkles,
  Zap
} from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/context/ThemeContext";
import { motion } from "framer-motion";

interface UserProfile {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  profile: {
    institution: string;
    course: string;
    year: string;
  };
  emailVerified: boolean;
}

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
}

interface Ticket {
  _id: string;
  eventId: Event;
  qrCode: string;
  token: string;
  checkedIn: boolean;
  checkInTime?: string;
  checkOutTime?: string;
  createdAt: string;
}

export default function UserDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme } = useTheme();
  
  const [activeTab, setActiveTab] = useState<"overview" | "tickets" | "profile">(
    (searchParams.get('tab') as any) || "overview"
  );
  const [user, setUser] = useState<UserProfile | null>(null);
  const [registeredEvents, setRegisteredEvents] = useState<Event[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalEvents: 0,
    upcomingEvents: 0,
    attendedEvents: 0
  });

  // Ticket Modal State
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Update URL when tab changes
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (activeTab === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', activeTab);
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [activeTab, router, searchParams]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch user profile
      const profileRes = await api.get("/auth/profile");
      if (!profileRes.data.success) throw new Error(profileRes.data.message);
      setUser(profileRes.data.user);

      // Fetch events & tickets concurrently
      const [eventsRes, ticketsRes] = await Promise.allSettled([
        api.get("/registration/user/events").catch(() => ({ data: { events: [] } })),
        api.get("/tickets/user-tickets").catch(() => ({ data: { tickets: [] } }))
      ]);

      const fetchedEvents = eventsRes.status === "fulfilled" ? eventsRes.value.data.events || [] : [];
      const fetchedTickets = ticketsRes.status === "fulfilled" ? (ticketsRes.value.data.tickets || []) : [];

      setRegisteredEvents(fetchedEvents);
      setTickets(fetchedTickets);

      // Calculate stats
      const now = new Date();
      const upcoming = fetchedEvents.filter((e: Event) => new Date(e.startDate) > now);
      const attended = fetchedTickets.filter((t: Ticket) => t.checkedIn);

      setStats({
        totalEvents: fetchedEvents.length,
        upcomingEvents: upcoming.length,
        attendedEvents: attended.length
      });

    } catch (err: any) {
      const errorMessage = err.response?.data?.message || "Failed to load dashboard data";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tab: "overview" | "tickets" | "profile") => {
    setActiveTab(tab);
  };

  const handleViewTicket = (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setShowTicketModal(true);
  };

  const handleCloseTicketModal = () => {
    setShowTicketModal(false);
    setSelectedTicket(null);
  };

  const downloadTicket = async (ticket: Ticket) => {
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

  if (loading) {
    return <DashboardSkeleton theme={theme} />;
  }

  if (error && !user) {
    return (
      <motion.div 
        className={`min-h-screen transition-colors duration-300 relative overflow-hidden ${
          theme === 'dark'
            ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white'
            : 'bg-gradient-to-br from-slate-50 to-blue-50 text-gray-900'
        }`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      >
        <div className="flex items-center justify-center p-4 min-h-screen">
          <Card className={`w-full max-w-md border-0 shadow-2xl backdrop-blur-sm transition-all duration-300 ${
            theme === 'dark'
              ? 'bg-slate-800/30 text-white'
              : 'bg-white/80 text-gray-900'
          }`}>
            <CardContent className="pt-8 pb-6">
              <div className="text-center">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${
                  theme === 'dark'
                    ? 'bg-red-500/20'
                    : 'bg-gradient-to-br from-red-100 to-red-200'
                }`}>
                  <AlertCircle className={`h-10 w-10 ${
                    theme === 'dark' ? 'text-red-400' : 'text-red-500'
                  }`} />
                </div>
                <h2 className={`text-2xl font-bold mb-3 ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  Error Loading Dashboard
                </h2>
                <p className={`mb-6 leading-relaxed ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  {error}
                </p>
                <div className="space-y-3">
                  <Button 
                    onClick={fetchDashboardData} 
                    className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl"
                  >
                    Try Again
                  </Button>
                  <Button variant="outline" className={`w-full transition-all ${
                    theme === 'dark'
                      ? 'border-slate-600 text-gray-300 hover:border-blue-500 hover:text-blue-400'
                      : 'border-2 hover:border-blue-300'
                  }`} asChild>
                    <Link href="/events">
                      Browse Events
                    </Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      className={`min-h-screen transition-colors duration-300 relative overflow-hidden ${
        theme === 'dark'
          ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white'
          : 'bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 text-gray-900'
      }`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8 }}
    >
      {/* Enhanced gradient overlay for dark theme */}
      {theme === 'dark' && (
        <motion.div 
          className="absolute inset-0 pointer-events-none z-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(255,255,255,0.02),transparent_40%)]" />
        </motion.div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute inset-0 bg-black/10"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between">
            <div className="flex items-center space-x-4 mb-4 md:mb-0">
              <div className="flex h-16 w-16 md:h-20 md:w-20 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm border-2 border-white/30 shadow-2xl">
                <User className="h-8 w-8 md:h-10 md:w-10 text-white" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-white to-blue-100 bg-clip-text text-transparent">
                  Welcome back, {user?.firstName || 'User'}!
                </h1>
                <div className="flex items-center flex-wrap gap-2">
                  <p className="text-blue-100 text-sm md:text-base">{user?.email}</p>
                  {user?.role === "admin" && (
                    <Badge className="bg-white/20 text-white border-0 backdrop-blur-sm px-2 py-1 text-xs">
                      <Shield className="h-3 w-3 mr-1" />
                      Admin
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-4 md:mt-0">
              <Button 
                variant="outline" 
                size="sm"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm transition-all duration-200"
                onClick={() => handleTabChange("profile")}
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit Profile
              </Button>
              <Button asChild variant="outline" size="sm" className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm transition-all duration-200">
                <Link href="/events">
                  <Calendar className="h-4 w-4 mr-2" />
                  Browse Events
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl p-4 flex items-center justify-between shadow-lg backdrop-blur-sm transition-all duration-300 ${
              theme === 'dark'
                ? 'bg-red-500/10 border border-red-500/20'
                : 'bg-gradient-to-r from-red-50 to-orange-50 border border-red-200'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-lg ${
                theme === 'dark' ? 'bg-red-500/20' : 'bg-red-100'
              }`}>
                <AlertCircle className={`h-5 w-5 ${
                  theme === 'dark' ? 'text-red-400' : 'text-red-600'
                }`} />
              </div>
              <p className={`font-medium text-sm ${
                theme === 'dark' ? 'text-red-300' : 'text-red-800'
              }`}>
                {error}
              </p>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className={`transition-all duration-200 ${
                theme === 'dark'
                  ? 'border-red-500/30 text-red-300 hover:bg-red-500/20'
                  : 'border-red-300 text-red-700 hover:bg-red-100'
              }`}
              onClick={fetchDashboardData}
            >
              Retry
            </Button>
          </motion.div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
          {/* Sidebar Navigation - Mobile First */}
          <div className="lg:w-64 order-2 lg:order-1">
            <Card className={`border-0 shadow-xl rounded-2xl lg:sticky lg:top-8 backdrop-blur-sm transition-all duration-300 ${
              theme === 'dark'
                ? 'bg-slate-800/30'
                : 'bg-white/70 border border-gray-200/60'
            }`}>
              <CardContent className="p-4">
                <nav className="space-y-2">
                  {[
                    { id: "overview", label: "Overview", icon: BarChart3, count: null },
                    { id: "tickets", label: "My Tickets", icon: Ticket, count: tickets.length },
                    { id: "profile", label: "Profile", icon: Settings, count: null },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <motion.button
                        key={item.id}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleTabChange(item.id as any)}
                        className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-sm font-semibold transition-all duration-300 group ${
                          activeTab === item.id
                            ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg"
                            : `text-gray-700 hover:shadow-lg border border-transparent hover:border-gray-200 ${
                                theme === 'dark'
                                  ? 'text-gray-300 hover:bg-slate-700/50 hover:text-white'
                                  : 'hover:bg-white hover:text-gray-900'
                              }`
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <Icon className={`h-4 w-4 ${
                            activeTab === item.id 
                              ? 'text-white' 
                              : theme === 'dark'
                                ? 'text-gray-400 group-hover:text-blue-400'
                                : 'text-gray-400 group-hover:text-blue-600'
                          }`} />
                          <span>{item.label}</span>
                        </div>
                        {item.count !== null && (
                          <span className={`px-2 py-1 rounded-full text-xs font-bold transition-all duration-300 ${
                            activeTab === item.id
                              ? "bg-white/20 text-white backdrop-blur-sm"
                              : theme === 'dark'
                                ? "bg-slate-700 text-gray-300 group-hover:bg-blue-500/20 group-hover:text-blue-400"
                                : "bg-gray-100 text-gray-600 group-hover:bg-blue-100 group-hover:text-blue-700"
                          }`}>
                            {item.count}
                          </span>
                        )}
                      </motion.button>
                    );
                  })}
                </nav>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0 order-1 lg:order-2">
            {activeTab === "overview" && (
              <OverviewTab 
                user={user}
                stats={stats}
                registeredEvents={registeredEvents}
                tickets={tickets}
                onViewAllRegistrations={() => router.push('/user/registrations')}
                onViewTicket={handleViewTicket}
                onRetry={fetchDashboardData}
                theme={theme}
              />
            )}

            {activeTab === "tickets" && (
              <TicketsTab 
                tickets={tickets}
                onDownloadTicket={downloadTicket}
                onViewTicket={handleViewTicket}
                onRetry={fetchDashboardData}
                theme={theme}
              />
            )}

            {activeTab === "profile" && (
              <ProfileTab 
                user={user}
                onProfileUpdate={fetchDashboardData}
                theme={theme}
              />
            )}
          </div>
        </div>
      </div>

      {/* Ticket Modal */}
      <TicketModal 
        ticket={selectedTicket}
        isOpen={showTicketModal}
        onClose={handleCloseTicketModal}
        onDownloadTicket={downloadTicket}
        theme={theme}
      />
    </motion.div>
  );
}

// Enhanced Overview Tab Component
function OverviewTab({ 
  user, stats, registeredEvents, tickets, onViewAllRegistrations, onViewTicket, onRetry, theme 
}: any) {
  const upcomingEvents = registeredEvents.slice(0, 3);
  const recentTickets = tickets.slice(0, 3);
  const router = useRouter();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Total Events"
          value={stats.totalEvents}
          description="All registrations"
          icon={BarChart3}
          color="blue"
          theme={theme}
        />
        <StatCard
          title="Upcoming"
          value={stats.upcomingEvents}
          description="Future events"
          icon={Clock}
          color="green"
          theme={theme}
        />
        <StatCard
          title="Attended"
          value={stats.attendedEvents}
          description="Completed events"
          icon={CheckCircle}
          color="purple"
          theme={theme}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Upcoming Events */}
        <SectionCard
          title="My Registrations"
          description="Your recently registered events"
          icon={Calendar}
          action={registeredEvents.length > 0 ? {
            label: "View All",
            onClick: onViewAllRegistrations
          } : undefined}
          theme={theme}
        >
          {upcomingEvents.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No registered events"
              description="Register for events to see them here"
              action={{
                label: "Browse Events",
                onClick: () => router.push('/events')
              }}
              theme={theme}
            />
          ) : (
            upcomingEvents.map((event: any, index: number) => (
              <EventCard 
                key={event._id} 
                event={event} 
                formatDate={formatDate}
                delay={index * 100}
                theme={theme}
              />
            ))
          )}
        </SectionCard>

        {/* Recent Tickets */}
        <SectionCard
          title="Recent Tickets"
          description="Your event access passes"
          icon={Ticket}
          action={tickets.length > 0 ? {
            label: "View All",
            onClick: () => {/* Tickets tab is handled by navigation */}
          } : undefined}
          theme={theme}
        >
          {recentTickets.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title="No tickets yet"
              description="Your event tickets will appear here"
              action={{
                label: "Register for Events",
                onClick: () => router.push('/events')
              }}
              theme={theme}
            />
          ) : (
            recentTickets.map((ticket: any, index: number) => (
              <TicketCard 
                key={ticket._id} 
                ticket={ticket} 
                formatDate={formatDate}
                onViewTicket={onViewTicket}
                delay={index * 100}
                theme={theme}
              />
            ))
          )}
        </SectionCard>
      </div>
    </div>
  );
}

// Reusable Stat Card Component
interface StatCardProps {
  title: string;
  value: number;
  description: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  color: "blue" | "green" | "purple";
  theme: string;
}

function StatCard({ title, value, description, icon: Icon, color, theme }: StatCardProps) {
  const colorClasses: { [key in "blue" | "green" | "purple"]: string } = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-green-500 to-emerald-600',
    purple: 'from-purple-500 to-indigo-600'
  };

  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      transition={{ duration: 0.2 }}
    >
      <Card className={`border-0 shadow-lg rounded-2xl hover:shadow-xl transition-all duration-300 backdrop-blur-sm ${
        theme === 'dark'
          ? 'bg-slate-800/30'
          : 'bg-white/70 border border-gray-200/60'
      }`}>
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-semibold mb-1 ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
              }`}>
                {title}
              </p>
              <p className={`text-2xl sm:text-3xl font-bold ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>
                {value}
              </p>
              <p className={`text-xs mt-1 ${
                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
              }`}>
                {description}
              </p>
            </div>
            <div className={`rounded-2xl bg-gradient-to-br ${colorClasses[color]} p-3 shadow-lg`}>
              <Icon className="h-6 w-6 text-white" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// Reusable Section Card Component
function SectionCard({ title, description, icon: Icon, action, children, theme }: any) {
  return (
    <Card className={`border-0 shadow-lg rounded-2xl transition-all duration-300 hover:shadow-xl backdrop-blur-sm ${
      theme === 'dark'
        ? 'bg-slate-800/30'
        : 'bg-white/70 border border-gray-200/60'
    }`}>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Icon className={`h-5 w-5 sm:h-6 sm:w-6 ${
              theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
            }`} />
            <span className={`text-lg sm:text-xl ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}>
              {title}
            </span>
          </div>
          {action && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={action.onClick}
              className={`transition-all duration-200 ${
                theme === 'dark'
                  ? 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/20'
                  : 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
              }`}
            >
              {action.label}
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </CardTitle>
        <CardDescription className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-4">
        {children}
      </CardContent>
    </Card>
  );
}

// Reusable Empty State Component
function EmptyState({ icon: Icon, title, description, action, theme }: any) {
  return (
    <div className="text-center py-6 sm:py-8">
      <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
        theme === 'dark'
          ? 'bg-slate-700/50'
          : 'bg-gradient-to-br from-gray-100 to-gray-200'
      }`}>
        <Icon className={`h-6 w-6 sm:h-8 sm:w-8 ${
          theme === 'dark' ? 'text-gray-400' : 'text-gray-400'
        }`} />
      </div>
      <p className={`font-medium mb-2 ${
        theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
      }`}>
        {title}
      </p>
      <p className={`text-sm mb-4 sm:mb-6 ${
        theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
      }`}>
        {description}
      </p>
      {action && (
        <Button 
          onClick={action.onClick}
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

// Enhanced Event Card Component
function EventCard({ event, formatDate, delay = 0, theme }: any) {
  const router = useRouter();

  const handleEventClick = () => {
    if (!event) return;
    router.push(`/events/${event.slug}`);
  };

  const getImageUrl = (imagePath: string | undefined) => {
    const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "";

    if (!imagePath) return '/api/placeholder/400/200';

    if (imagePath.startsWith('http')) return imagePath;

    const normalizedBase = BASE_URL === "" ? "" : (BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`);
    const normalizedPath = imagePath.startsWith('/') ? imagePath.substring(1) : imagePath;
    return `${normalizedBase}${normalizedPath}`;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay / 1000 }}
      className="flex items-center space-x-3 p-3 sm:p-4 rounded-xl border border-gray-200/60 hover:shadow-lg transition-all duration-300 transform hover:-translate-y-0.5 group cursor-pointer backdrop-blur-sm"
      onClick={handleEventClick}
      style={{
        backgroundColor: theme === 'dark' ? 'rgba(30, 41, 59, 0.3)' : 'rgba(255, 255, 255, 0.5)',
        borderColor: theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
      }}
    >
      <img 
        src={getImageUrl(event.bannerUrl)} 
        alt={event.title}
        className="h-12 w-12 sm:h-14 sm:w-14 rounded-xl object-cover flex-shrink-0 shadow-md group-hover:shadow-lg transition-all duration-300"
      />
      <div className="flex-1 min-w-0">
        <p className={`font-semibold truncate text-sm sm:text-base group-hover:text-blue-600 transition-colors ${
          theme === 'dark' ? 'text-white' : 'text-gray-900'
        }`}>
          {event.title}
        </p>
        <p className={`text-xs sm:text-sm mt-1 truncate ${
          theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
        }`}>
          {formatDate(event.startDate)} • {event.venue}
        </p>
        {event.category && (
          <Badge variant="outline" className={`mt-2 text-xs ${
            theme === 'dark'
              ? 'bg-blue-500/20 text-blue-300 border-blue-400/30'
              : 'bg-blue-50 text-blue-700 border-blue-200'
          }`}>
            {event.category}
          </Badge>
        )}
      </div>
      <ArrowRight className={`h-4 w-4 sm:h-5 sm:w-5 transition-all duration-300 transform group-hover:translate-x-1 flex-shrink-0 ${
        theme === 'dark' ? 'text-gray-500 group-hover:text-blue-400' : 'text-gray-400 group-hover:text-blue-600'
      }`} />
    </motion.div>
  );
}

// Enhanced Ticket Card Component
function TicketCard({ ticket, formatDate, onViewTicket, delay = 0, theme }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay / 1000 }}
      className="flex items-center justify-between p-3 sm:p-4 rounded-xl border border-gray-200/60 hover:shadow-lg transition-all duration-300 transform hover:-translate-y-0.5 group backdrop-blur-sm"
      style={{
        backgroundColor: theme === 'dark' ? 'rgba(30, 41, 59, 0.3)' : 'rgba(255, 255, 255, 0.5)',
        borderColor: theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
      }}
    >
      <div className="flex items-center space-x-3 sm:space-x-4">
        <div className={`p-2 sm:p-3 rounded-xl transition-all duration-300 group-hover:scale-110 ${
          ticket.checkedIn 
            ? theme === 'dark'
              ? 'bg-gradient-to-br from-green-500/20 to-emerald-500/20'
              : 'bg-gradient-to-br from-green-100 to-emerald-100'
            : theme === 'dark'
              ? 'bg-gradient-to-br from-blue-500/20 to-indigo-500/20'
              : 'bg-gradient-to-br from-blue-100 to-indigo-100'
        }`}>
          {ticket.checkedIn ? (
            <CheckCircle className={`h-4 w-4 sm:h-5 sm:w-5 ${
              theme === 'dark' ? 'text-green-400' : 'text-green-600'
            }`} />
          ) : (
            <Ticket className={`h-4 w-4 sm:h-5 sm:w-5 ${
              theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
            }`} />
          )}
        </div>
        <div className="min-w-0">
          <p className={`font-semibold group-hover:text-purple-600 transition-colors truncate text-sm sm:text-base ${
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          }`}>
            {ticket.eventId.title}
          </p>
          <p className={`text-xs sm:text-sm mt-1 ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {formatDate(ticket.eventId.startDate)}
          </p>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <p className={`text-xs font-semibold px-2 py-1 rounded-full ${
          ticket.checkedIn 
            ? theme === 'dark'
              ? 'bg-green-500/20 text-green-300'
              : 'bg-green-100 text-green-700'
            : theme === 'dark'
              ? 'bg-blue-500/20 text-blue-300'
              : 'bg-blue-100 text-blue-700'
        }`}>
          {ticket.checkedIn ? 'Checked In' : 'Active'}
        </p>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => onViewTicket(ticket)}
          className={`h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-md hover:shadow-lg ${
            theme === 'dark'
              ? 'bg-slate-700/50 hover:bg-slate-600/50'
              : 'bg-white'
          }`}
        >
          <QrCode className={`h-3 w-3 sm:h-4 sm:w-4 ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
          }`} />
        </Button>
      </div>
    </motion.div>
  );
}

// Enhanced Tickets Tab
function TicketsTab({ tickets, onDownloadTicket, onViewTicket, onRetry, theme }: any) {
  const router = useRouter();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleEventClick = (eventSlug: string) => {
    router.push(`/events`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className={`text-2xl sm:text-3xl font-bold ${
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          }`}>
            My Tickets
          </h2>
          <p className={`mt-2 ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
          }`}>
            Your event access passes with QR codes
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            asChild
            variant="outline"
            size="sm"
            className={`transition-all duration-200 ${
              theme === 'dark'
                ? 'border-slate-600 text-gray-300 hover:border-blue-500 hover:text-blue-400'
                : 'border-2 hover:border-blue-300'
            }`}
          >
            <Link href="/events">
              <Calendar className="h-4 w-4 mr-2" />
              Browse Events
            </Link>
          </Button>
        </div>
      </div>

      {tickets.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title="No Tickets Yet"
          description="You don't have any event tickets yet. Register for events to get your access passes."
          action={{
            label: "Register for Events",
            onClick: () => router.push('/events')
          }}
          theme={theme}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-6">
          {tickets.map((ticket: any, index: number) => (
            <motion.div
              key={ticket._id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className={`border-0 shadow-lg rounded-2xl hover:shadow-xl transition-all duration-300 backdrop-blur-sm ${
                theme === 'dark'
                  ? 'bg-slate-800/30'
                  : 'bg-white/70 border border-gray-200/60'
              }`}>
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col lg:flex-row gap-4 sm:gap-6">
                    {/* Event Info */}
                    <div className="flex-1">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-4 gap-2">
                        <div className="flex-1">
                          <h3 
                            className={`text-lg sm:text-xl font-bold mb-2 sm:mb-3 hover:text-blue-600 cursor-pointer transition-colors line-clamp-2 ${
                              theme === 'dark' ? 'text-white' : 'text-gray-900'
                            }`}
                            onClick={() => handleEventClick(ticket.eventId.slug)}
                          >
                            {ticket.eventId.title}
                          </h3>
                          <div className="space-y-2 text-sm">
                            <div className={`flex items-center space-x-2 rounded-lg px-3 py-2 ${
                              theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-50'
                            }`}>
                              <Calendar className={`h-4 w-4 ${
                                theme === 'dark' ? 'text-blue-400' : 'text-blue-500'
                              }`} />
                              <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
                                {formatDate(ticket.eventId.startDate)} at {formatTime(ticket.eventId.startDate)}
                              </span>
                            </div>
                            <div className={`flex items-center space-x-2 rounded-lg px-3 py-2 ${
                              theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-50'
                            }`}>
                              <MapPin className={`h-4 w-4 ${
                                theme === 'dark' ? 'text-green-400' : 'text-green-500'
                              }`} />
                              <span className={`truncate ${
                                theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                              }`}>
                                {ticket.eventId.venue}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className={`inline-flex items-center px-3 py-1 sm:px-4 sm:py-2 rounded-full text-sm font-semibold border ${
                          ticket.checkedIn 
                            ? theme === 'dark'
                              ? 'bg-green-500/20 text-green-300 border-green-400/30'
                              : 'bg-green-100 text-green-800 border-green-200'
                            : theme === 'dark'
                              ? 'bg-blue-500/20 text-blue-300 border-blue-400/30'
                              : 'bg-blue-100 text-blue-800 border-blue-200'
                        }`}>
                          {ticket.checkedIn ? (
                            <>
                              <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                              Checked In
                            </>
                          ) : (
                            <>
                              <Ticket className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                              Active
                            </>
                          )}
                        </div>
                      </div>

                      {ticket.checkedIn && ticket.checkInTime && (
                        <div className={`border rounded-xl p-3 sm:p-4 mb-4 ${
                          theme === 'dark'
                            ? 'bg-green-500/10 border-green-500/20'
                            : 'bg-green-50 border-green-200'
                        }`}>
                          <p className={`text-sm font-semibold flex items-center ${
                            theme === 'dark' ? 'text-green-300' : 'text-green-800'
                          }`}>
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Checked in at {formatTime(ticket.checkInTime)}
                          </p>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleEventClick(ticket.eventId.slug)}
                          className={`transition-all ${
                            theme === 'dark'
                              ? 'border-slate-600 text-gray-300 hover:border-blue-500 hover:text-blue-400'
                              : 'border-2 hover:border-blue-300'
                          }`}
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          View Event
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => onDownloadTicket(ticket)}
                          className={`transition-all ${
                            theme === 'dark'
                              ? 'border-slate-600 text-gray-300 hover:border-green-500 hover:text-green-400'
                              : 'border-2 hover:border-green-300'
                          }`}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                        <Button 
                          size="sm"
                          onClick={() => onViewTicket(ticket)}
                          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl"
                        >
                          <QrCode className="h-4 w-4 mr-2" />
                          View Ticket
                        </Button>
                      </div>
                    </div>

                    {/* QR Code */}
                    <div className="lg:w-32 xl:w-48 flex flex-col items-center justify-center">
                      <div className={`p-3 sm:p-4 rounded-xl border-2 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 cursor-pointer ${
                        theme === 'dark'
                          ? 'bg-slate-700/50 border-slate-600'
                          : 'bg-white border-gray-200'
                      }`}
                           onClick={() => onViewTicket(ticket)}>
                        <img 
                          src={ticket.qrCode} 
                          alt="QR Code"
                          className="w-24 h-24 sm:w-32 sm:h-32"
                        />
                      </div>
                      <p className={`text-xs mt-2 text-center font-medium ${
                        theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        Scan for event entry
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// Enhanced Profile Tab
function ProfileTab({ user, onProfileUpdate, theme }: any) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const [form, setForm] = useState({
    institution: user?.profile?.institution || "",
    course: user?.profile?.course || "",
    year: user?.profile?.year || ""
  });

  // Update form when user data changes
  useEffect(() => {
    if (user) {
      setForm({
        institution: user?.profile?.institution || "",
        course: user?.profile?.course || "",
        year: user?.profile?.year || ""
      });
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      await api.put("/auth/profile", form);
      setMessage({ type: 'success', text: "Profile updated successfully!" });
      onProfileUpdate();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.response?.data?.message || "Failed to update profile" });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className={`text-2xl sm:text-3xl font-bold ${
          theme === 'dark' ? 'text-white' : 'text-gray-900'
        }`}>
          Profile Settings
        </h2>
        <p className={`mt-2 ${
          theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
        }`}>
          Update your personal information and preferences
        </p>
      </div>

      <Card className={`border-0 shadow-lg rounded-2xl transition-all duration-300 hover:shadow-xl backdrop-blur-sm ${
        theme === 'dark'
          ? 'bg-slate-800/30'
          : 'bg-white/70 border border-gray-200/60'
      }`}>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center space-x-2">
            <User className={`h-5 w-5 sm:h-6 sm:w-6 ${
              theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
            }`} />
            <span className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>
              Personal Information
            </span>
          </CardTitle>
          <CardDescription className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
            Update your profile details and institutional information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Read-only Basic Info */}
            <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 p-4 sm:p-6 rounded-2xl border ${
              theme === 'dark'
                ? 'bg-gradient-to-br from-slate-700/50 to-blue-500/10 border-slate-600'
                : 'bg-gradient-to-br from-gray-50 to-blue-50 border-gray-200'
            }`}>
              <div>
                <label className={`text-sm font-semibold mb-2 block ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  First Name
                </label>
                <p className={`font-bold text-base sm:text-lg ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  {user?.firstName}
                </p>
              </div>
              <div>
                <label className={`text-sm font-semibold mb-2 block ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  Last Name
                </label>
                <p className={`font-bold text-base sm:text-lg ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  {user?.lastName}
                </p>
              </div>
              <div className="md:col-span-2">
                <label className={`text-sm font-semibold mb-2 block ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  Email
                </label>
                <p className={`font-bold text-base sm:text-lg ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  {user?.email}
                </p>
                <div className="flex items-center mt-2">
                  {user?.emailVerified ? (
                    <Badge className={`px-2 py-1 text-xs ${
                      theme === 'dark'
                        ? 'bg-green-500/20 text-green-300 border-green-400/30'
                        : 'bg-green-100 text-green-800 border-green-200'
                    }`}>
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Verified
                    </Badge>
                  ) : (
                    <Badge className={`px-2 py-1 text-xs ${
                      theme === 'dark'
                        ? 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30'
                        : 'bg-yellow-100 text-yellow-800 border-yellow-200'
                    }`}>
                      <XCircle className="h-3 w-3 mr-1" />
                      Not Verified
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Editable Profile Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              <div className="space-y-2">
                <label htmlFor="institution" className={`block text-sm font-semibold ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  Institution/Organization
                </label>
                <input
                  id="institution"
                  name="institution"
                  type="text"
                  value={form.institution}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 sm:px-4 sm:py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 ${
                    theme === 'dark'
                      ? 'bg-slate-700/50 border-slate-600 text-white placeholder-gray-400'
                      : 'bg-white/50 border-gray-200 text-gray-600'
                  }`}
                  placeholder="Your institution"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="course" className={`block text-sm font-semibold ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  Course/Program
                </label>
                <input
                  id="course"
                  name="course"
                  type="text"
                  value={form.course}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 sm:px-4 sm:py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 ${
                    theme === 'dark'
                      ? 'bg-slate-700/50 border-slate-600 text-white placeholder-gray-400'
                      : 'bg-white/50 border-gray-200 text-gray-600'
                  }`}
                  placeholder="Your course or program"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="year" className={`block text-sm font-semibold ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  Academic Year
                </label>
                <input
                  id="year"
                  name="year"
                  type="text"
                  value={form.year}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 sm:px-4 sm:py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 ${
                    theme === 'dark'
                      ? 'bg-slate-700/50 border-slate-600 text-white placeholder-gray-400'
                      : 'bg-white/50 border-gray-200 text-gray-600'
                  }`}
                  placeholder="e.g., 2nd Year"
                />
              </div>
            </div>

            {message && (
              <div className={`p-3 sm:p-4 rounded-xl border-2 font-semibold ${
                message.type === 'success' 
                  ? theme === 'dark'
                    ? "bg-green-500/10 border-green-500/20 text-green-300"
                    : "bg-green-50 border-green-200 text-green-700"
                  : theme === 'dark'
                    ? "bg-red-500/10 border-red-500/20 text-red-300"
                    : "bg-red-50 border-red-200 text-red-700"
              }`}>
                {message.text}
              </div>
            )}

            <Button 
              type="submit" 
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl py-2 sm:py-3 rounded-xl font-semibold"
            >
              {loading ? (
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Updating...</span>
                </div>
              ) : (
                "Update Profile"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// Enhanced Ticket Modal Component
function TicketModal({ ticket, isOpen, onClose, onDownloadTicket, theme }: { ticket: Ticket | null; isOpen: boolean; onClose: () => void; onDownloadTicket: (ticket: Ticket) => void; theme: string }) {
  const [copying, setCopying] = useState(false);

  if (!isOpen || !ticket) return null;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border ${
          theme === 'dark'
            ? 'bg-slate-800 border-slate-700'
            : 'bg-white border-gray-200'
        }`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between p-4 sm:p-6 border-b rounded-t-2xl ${
          theme === 'dark'
            ? 'bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border-slate-700'
            : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-gray-100'
        }`}>
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg ${
              theme === 'dark' ? 'bg-blue-500/20' : 'bg-blue-100'
            }`}>
              <Ticket className={`h-5 w-5 sm:h-6 sm:w-6 ${
                theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
              }`} />
            </div>
            <div>
              <h2 className={`text-lg sm:text-xl font-bold ${
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
                ? 'hover:bg-slate-700/50'
                : 'hover:bg-gray-100'
            }`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Ticket Content */}
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Event Info */}
          <div className="text-center">
            <h3 className={`text-base sm:text-lg font-bold mb-2 sm:mb-3 line-clamp-2 ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}>
              {ticket.eventId.title}
            </h3>
            <div className="space-y-2 text-sm">
              <div className={`flex items-center justify-center space-x-2 rounded-lg py-2 ${
                theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-50'
              }`}>
                <Calendar className={`h-4 w-4 ${
                  theme === 'dark' ? 'text-blue-400' : 'text-blue-500'
                }`} />
                <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
                  {formatDate(ticket.eventId.startDate)}
                </span>
              </div>
              <div className={`flex items-center justify-center space-x-2 rounded-lg py-2 ${
                theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-50'
              }`}>
                <MapPin className={`h-4 w-4 ${
                  theme === 'dark' ? 'text-green-400' : 'text-green-500'
                }`} />
                <span className={`max-w-xs truncate ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  {ticket.eventId.venue}
                </span>
              </div>
              {ticket.checkedIn && ticket.checkInTime && (
                <div className={`border rounded-lg p-2 sm:p-3 mt-2 ${
                  theme === 'dark'
                    ? 'bg-green-500/10 border-green-500/20'
                    : 'bg-green-50 border-green-200'
                }`}>
                  <p className={`font-medium flex items-center justify-center text-sm ${
                    theme === 'dark' ? 'text-green-300' : 'text-green-800'
                  }`}>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Checked in at {formatTime(ticket.checkInTime)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* QR Code */}
          <div className="flex flex-col items-center space-y-3 sm:space-y-4">
            <div className={`p-3 sm:p-4 rounded-xl border-2 shadow-lg hover:shadow-xl transition-all duration-300 ${
              theme === 'dark'
                ? 'bg-slate-700/50 border-slate-600'
                : 'bg-white border-gray-200'
            }`}>
              <img 
                src={ticket.qrCode} 
                alt="QR Code"
                className="w-48 h-48 sm:w-56 sm:h-56"
              />
            </div>
            <p className={`text-sm text-center font-medium ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
            }`}>
              Scan this QR code for event entry
            </p>
          </div>

          {/* Ticket Details */}
          <div className={`rounded-xl p-3 sm:p-4 space-y-2 sm:space-y-3 border ${
            theme === 'dark'
              ? 'bg-slate-700/50 border-slate-600'
              : 'bg-gradient-to-br from-gray-50 to-blue-50 border-gray-200'
          }`}>
            <div className="flex justify-between items-center">
              <span className={`text-sm font-semibold ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Ticket Status:
              </span>
              <Badge 
                className={`font-medium px-2 sm:px-3 py-1 text-xs ${
                  ticket.checkedIn
                    ? theme === 'dark'
                      ? 'bg-green-500/20 text-green-300 border-green-400/30'
                      : 'bg-green-100 text-green-800 border-green-200'
                    : theme === 'dark'
                      ? 'bg-blue-500/20 text-blue-300 border-blue-400/30'
                      : 'bg-blue-100 text-blue-800 border-blue-200'
                }`}
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
                <code className={`text-xs px-2 sm:px-3 py-1 rounded-lg border font-mono ${
                  theme === 'dark'
                    ? 'bg-slate-600 border-slate-500 text-gray-300'
                    : 'bg-white border-gray-300'
                }`}>
                  {ticket.token.substring(0, 8)}...
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyToken}
                  disabled={copying}
                  className={`h-6 w-6 sm:h-7 sm:w-7 p-0 transition-colors ${
                    theme === 'dark'
                      ? 'hover:bg-slate-600'
                      : 'hover:bg-gray-100'
                  }`}
                >
                  <Copy className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-2 sm:space-x-3">
            <Button
              variant="outline"
              onClick={() => onDownloadTicket(ticket)}
              className={`flex-1 border-2 transition-all duration-200 text-sm ${
                theme === 'dark'
                  ? 'border-slate-600 text-gray-300 hover:border-blue-500 hover:text-blue-400 hover:bg-blue-500/20'
                  : 'hover:border-blue-300 hover:bg-blue-50'
              }`}
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
            <Button
              onClick={onClose}
              className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl text-sm"
            >
              <Ticket className="h-4 w-4 mr-2" />
              Close
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// Enhanced Skeleton
function DashboardSkeleton({ theme }: { theme: string }) {
  return (
    <motion.div 
      className={`min-h-screen transition-colors duration-300 ${
        theme === 'dark'
          ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950'
          : 'bg-gradient-to-br from-slate-50 to-blue-50'
      }`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8 }}
    >
      {/* Header Skeleton */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center space-x-4">
            <Skeleton className="h-16 w-16 md:h-20 md:w-20 rounded-full bg-white/20" />
            <div className="space-y-3">
              <Skeleton className="h-6 md:h-8 w-32 md:w-48 bg-white/20" />
              <Skeleton className="h-4 w-24 md:w-32 bg-white/20" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
          {/* Sidebar Skeleton */}
          <div className="lg:w-64">
            <Card className={`border-0 rounded-2xl backdrop-blur-sm ${
              theme === 'dark' ? 'bg-slate-800/30' : 'bg-white/70'
            }`}>
              <CardContent className="p-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className={`h-12 w-full rounded-xl ${
                    theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-200/50'
                  }`} />
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Main Content Skeleton */}
          <div className="flex-1 space-y-6">
            {/* Stats Skeleton */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Card key={i} className={`border-0 rounded-2xl backdrop-blur-sm ${
                  theme === 'dark' ? 'bg-slate-800/30' : 'bg-white/70'
                }`}>
                  <CardContent className="p-4 sm:p-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-2">
                        <Skeleton className={`h-4 w-16 sm:w-20 ${
                          theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-200/50'
                        }`} />
                        <Skeleton className={`h-6 sm:h-8 w-12 sm:w-16 ${
                          theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-200/50'
                        }`} />
                        <Skeleton className={`h-3 w-20 sm:w-24 ${
                          theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-200/50'
                        }`} />
                      </div>
                      <Skeleton className={`h-10 w-10 sm:h-12 sm:w-12 rounded-2xl ${
                        theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-200/50'
                      }`} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Content Skeleton */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {[1, 2].map((i) => (
                <Card key={i} className={`border-0 rounded-2xl backdrop-blur-sm ${
                  theme === 'dark' ? 'bg-slate-800/30' : 'bg-white/70'
                }`}>
                  <CardHeader>
                    <Skeleton className={`h-5 w-24 sm:w-32 mb-2 ${
                      theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-200/50'
                    }`} />
                    <Skeleton className={`h-4 w-32 sm:w-48 ${
                      theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-200/50'
                    }`} />
                  </CardHeader>
                  <CardContent className="space-y-3 sm:space-y-4">
                    {[1, 2, 3].map((j) => (
                      <Skeleton key={j} className={`h-16 sm:h-20 w-full rounded-xl ${
                        theme === 'dark' ? 'bg-slate-700/50' : 'bg-gray-200/50'
                      }`} />
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}