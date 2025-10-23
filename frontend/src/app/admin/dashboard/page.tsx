// app/admin/dashboard/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { jwtDecode } from "jwt-decode";
import Link from "next/link";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Users, 
  Calendar, 
  Ticket, 
  BarChart3, 
  TrendingUp, 
  CheckCircle,
  AlertCircle,
  Settings,
  LogOut,
  Eye,
  Download,
  Filter,
  Search,
  User,
  Shield,
  ArrowRight,
  FileText,
  QrCode,
  Clock,
  MapPin,
  Plus,
  Scan
} from "lucide-react";
import { toast } from "sonner";

interface DecodedToken {
  id: string;
  role: string;
  exp: number;
}

interface Stats {
  totalUsers: number;
  totalEvents: number;
  activeParticipants: number;
  totalRegistrations: number;
  upcomingEvents: number;
  recentRegistrations: number;
}

interface RecentActivity {
  _id: string;
  type: 'registration' | 'event_created' | 'user_joined';
  title: string;
  description: string;
  timestamp: string;
  user?: {
    name: string;
    email: string;
  };
  event?: {
    title: string;
    slug: string;
  };
}

export default function AdminDashboard() {
  const router = useRouter();
  const [adminId, setAdminId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/login");
      return;
    }

    try {
      const decoded: DecodedToken = jwtDecode(token);
      if (decoded.exp * 1000 < Date.now()) {
        localStorage.clear();
        router.replace("/login");
        return;
      }

      if (decoded.role !== "admin") {
        router.replace("/login");
        return;
      }

      setAdminId(decoded.id);
      fetchDashboardData();
    } catch (err) {
      console.error("Token decoding failed:", err);
      localStorage.clear();
      router.replace("/login");
    }
  }, [router]);

  const fetchDashboardData = async () => {
    try {
      const token = localStorage.getItem("token");
      const [statsRes, activityRes] = await Promise.all([
        api.get("/admin/stats", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        api.get("/admin/activity", {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => ({ data: { activity: [] } })) // Fallback if endpoint doesn't exist
      ]);

      setStats(statsRes.data);
      setRecentActivity(activityRes.data.activity || []);
    } catch (err) {
      console.error("Failed to fetch dashboard data", err);
      toast.error("Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    router.replace("/login");
    toast.success("Logged out successfully");
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute inset-0 bg-black/10"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between">
            <div className="flex items-center space-x-4 mb-4 md:mb-0">
              <div className="flex h-16 w-16 md:h-20 md:w-20 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm border-2 border-white/30 shadow-2xl">
                <Shield className="h-8 w-8 md:h-10 md:w-10 text-white" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-white to-blue-100 bg-clip-text text-transparent">
                  Admin Dashboard
                </h1>
                <div className="flex items-center flex-wrap gap-2">
                  <p className="text-blue-100 text-sm md:text-base">Administrator Panel</p>
                  <Badge variant="secondary" className="bg-white/20 text-white border-0 backdrop-blur-sm px-2 py-1 text-xs">
                    <Shield className="h-3 w-3 mr-1" />
                    Super Admin
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-4 md:mt-0">
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleLogout}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm transition-all duration-200"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 lg:gap-8">
          {/* Sidebar Navigation */}
          <div className="lg:col-span-1 space-y-6">
            {/* Main Navigation */}
            <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-xl rounded-2xl">
              <CardContent className="p-4">
                <nav className="space-y-2">
                  {[
                    { id: "overview", label: "Overview", icon: BarChart3, href: "/admin/dashboard" },
                    { id: "users", label: "Users", icon: Users, href: "/admin/users" },
                    { id: "events", label: "Events", icon: Calendar, href: "/admin/events" },
                    { id: "registrations", label: "Registrations", icon: Ticket, href: "/admin/registrations" },
                    { id: "settings", label: "Settings", icon: Settings, href: "/admin/settings" },
                  ].map((item) => {
                    const Icon = item.icon;
                    const isActive = item.href === "/admin/dashboard"; // Simple active check
                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300 group ${
                          isActive
                            ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg"
                            : "text-gray-700 hover:bg-white hover:text-gray-900 hover:shadow-lg border border-transparent hover:border-gray-200"
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <Icon className={`h-5 w-5 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-blue-600'}`} />
                          <span>{item.label}</span>
                        </div>
                        <ArrowRight className={`h-4 w-4 transition-all duration-300 ${
                          isActive ? 'text-white' : 'text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1'
                        }`} />
                      </Link>
                    );
                  })}
                </nav>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-xl rounded-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center space-x-2 text-sm">
                  <Settings className="h-4 w-4 text-blue-600" />
                  <span>Quick Actions</span>
                </CardTitle>
                <CardDescription className="text-xs text-gray-600">
                  Frequently used actions
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="grid grid-cols-2 gap-2">
                  <Link href="/admin/events/create">
                    <Button className="w-full h-16 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl flex flex-col gap-1">
                      <Plus className="h-4 w-4" />
                      <span className="text-xs font-medium">Create Event</span>
                    </Button>
                  </Link>
                  <Link href="/admin/scan">
                    <Button variant="outline" className="w-full h-16 border-2 hover:border-green-300 transition-all duration-200 flex flex-col gap-1">
                      <Scan className="h-4 w-4" />
                      <span className="text-xs font-medium">Scan Tickets</span>
                    </Button>
                  </Link>
                  <Link href="/admin/users">
                    <Button variant="outline" className="w-full h-16 border-2 hover:border-purple-300 transition-all duration-200 flex flex-col gap-1">
                      <Users className="h-4 w-4" />
                      <span className="text-xs font-medium">Manage Users</span>
                    </Button>
                  </Link>
                  <Link href="/admin/events">
                    <Button variant="outline" className="w-full h-16 border-2 hover:border-orange-300 transition-all duration-200 flex flex-col gap-1">
                      <Eye className="h-4 w-4" />
                      <span className="text-xs font-medium">View Events</span>
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-8">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <StatCard
                title="Total Users"
                value={stats?.totalUsers || 0}
                description="Registered users"
                icon={Users}
                color="blue"
                trend={{ value: 12, isPositive: true }}
              />
              <StatCard
                title="Total Events"
                value={stats?.totalEvents || 0}
                description="Created events"
                icon={Calendar}
                color="green"
                trend={{ value: 8, isPositive: true }}
              />
              <StatCard
                title="Active Participants"
                value={stats?.activeParticipants || 0}
                description="Checked-in attendees"
                icon={CheckCircle}
                color="purple"
                trend={{ value: 24, isPositive: true }}
              />
              <StatCard
                title="Total Registrations"
                value={stats?.totalRegistrations || 0}
                description="Event registrations"
                icon={Ticket}
                color="orange"
                trend={{ value: 15, isPositive: true }}
              />
              <StatCard
                title="Upcoming Events"
                value={stats?.upcomingEvents || 0}
                description="Scheduled events"
                icon={Clock}
                color="indigo"
                trend={{ value: 3, isPositive: true }}
              />
              <StatCard
                title="Recent Registrations"
                value={stats?.recentRegistrations || 0}
                description="Last 7 days"
                icon={TrendingUp}
                color="pink"
                trend={{ value: 18, isPositive: true }}
              />
            </div>

            {/* Recent Activity - Full Width */}
            <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl transition-all duration-300 hover:shadow-xl">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center space-x-2">
                  <TrendingUp className="h-6 w-6 text-purple-600" />
                  <span>Recent Activity</span>
                </CardTitle>
                <CardDescription className="text-gray-600">
                  Latest platform activities and user interactions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                  {recentActivity.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 p-6 text-center">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="h-8 w-8 text-gray-400" />
                      </div>
                      <p className="text-gray-700 font-medium mb-2 text-base">No recent activity</p>
                      <p className="text-gray-500 text-sm max-w-md">
                        Activities will appear here as users register for events, create new events, or join the platform
                      </p>
                    </div>
                  ) : (
                    recentActivity.map((activity, index) => (
                      <ActivityItem key={activity._id} activity={activity} index={index} />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <style jsx>{`
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.5);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: rgba(156, 163, 175, 0.7);
        }
      `}</style>
    </div>
  );
}

// Stat Card Component
type Color = 'blue' | 'green' | 'purple' | 'orange' | 'indigo' | 'pink';
interface StatCardProps {
  title: string;
  value: number;
  description: string;
  icon: any;
  color: Color;
  trend?: { value: number; isPositive: boolean } | null;
}
function StatCard({ title, value, description, icon: Icon, color, trend }: StatCardProps) {
  const colorClasses = {
    blue: { bg: 'from-blue-500 to-blue-600', text: 'text-blue-600' },
    green: { bg: 'from-green-500 to-emerald-600', text: 'text-green-600' },
    purple: { bg: 'from-purple-500 to-indigo-600', text: 'text-purple-600' },
    orange: { bg: 'from-orange-500 to-red-600', text: 'text-orange-600' },
    indigo: { bg: 'from-indigo-500 to-blue-600', text: 'text-indigo-600' },
    pink: { bg: 'from-pink-500 to-rose-600', text: 'text-pink-600' }
  };

  return (
    <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-600 mb-1">{title}</p>
            <p className="text-3xl font-bold text-gray-900">{value.toLocaleString()}</p>
            <p className="text-xs text-gray-500 mt-1">{description}</p>
          </div>
          <div className={`rounded-2xl bg-gradient-to-br ${colorClasses[color].bg} p-3 shadow-lg`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
        </div>
        {trend && (
          <div className="mt-4 flex items-center text-sm font-medium">
            <TrendingUp className={`h-4 w-4 mr-1 ${trend.isPositive ? 'text-green-500' : 'text-red-500'}`} />
            <span className={trend.isPositive ? 'text-green-600' : 'text-red-600'}>
              {trend.isPositive ? '+' : ''}{trend.value}%
            </span>
            <span className="text-gray-500 ml-2">from last month</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Activity Item Component
function ActivityItem({ activity, index }: { activity: RecentActivity; index: number }) {
  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'registration':
        return <Ticket className="h-4 w-4 text-green-500" />;
      case 'event_created':
        return <Calendar className="h-4 w-4 text-blue-500" />;
      case 'user_joined':
        return <User className="h-4 w-4 text-purple-500" />;
      default:
        return <TrendingUp className="h-4 w-4 text-gray-500" />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'registration':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'event_created':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'user_joined':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  return (
    <div 
      className="flex items-start space-x-3 p-3 rounded-xl border border-gray-200/60 bg-white/50 hover:bg-white hover:shadow-lg transition-all duration-300"
    >
      <div className={`p-2 rounded-lg ${getActivityColor(activity.type)} mt-0.5 flex-shrink-0`}>
        {getActivityIcon(activity.type)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm leading-tight">{activity.title}</p>
        <p className="text-gray-600 text-xs mt-1 line-clamp-2">{activity.description}</p>
        <p className="text-xs text-gray-400 mt-2">
          {new Date(activity.timestamp).toLocaleDateString()} • {new Date(activity.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

// Loading Skeleton
function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header Skeleton */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center space-x-4">
            <div className="h-16 w-16 md:h-20 md:w-20 bg-white/20 rounded-full animate-pulse"></div>
            <div className="space-y-3">
              <div className="h-6 md:h-8 w-48 md:w-64 bg-white/20 rounded animate-pulse"></div>
              <div className="h-4 w-32 bg-white/20 rounded animate-pulse"></div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 lg:gap-8">
          {/* Sidebar Skeleton */}
          <div className="lg:col-span-1 space-y-6">
            <Card className="border border-gray-200 bg-white/70 backdrop-blur-sm rounded-2xl">
              <CardContent className="p-4 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-12 w-full bg-gray-200/50 rounded-xl animate-pulse"></div>
                ))}
              </CardContent>
            </Card>
            <Card className="border border-gray-200 bg-white/70 backdrop-blur-sm rounded-2xl">
              <CardHeader className="pb-3">
                <div className="h-4 w-24 bg-gray-200/50 rounded animate-pulse mb-2"></div>
                <div className="h-3 w-32 bg-gray-200/50 rounded animate-pulse"></div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="grid grid-cols-2 gap-2">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="h-16 w-full bg-gray-200/50 rounded-lg animate-pulse"></div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content Skeleton */}
          <div className="lg:col-span-3 space-y-8">
            {/* Stats Skeleton */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Card key={i} className="border border-gray-200 bg-white/70 backdrop-blur-sm rounded-2xl">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-2">
                        <div className="h-4 w-20 bg-gray-200/50 rounded animate-pulse"></div>
                        <div className="h-8 w-16 bg-gray-200/50 rounded animate-pulse"></div>
                        <div className="h-3 w-24 bg-gray-200/50 rounded animate-pulse"></div>
                      </div>
                      <div className="h-12 w-12 bg-gray-200/50 rounded-2xl animate-pulse"></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Recent Activity Skeleton */}
            <Card className="border border-gray-200 bg-white/70 backdrop-blur-sm rounded-2xl">
              <CardHeader>
                <div className="h-6 w-32 bg-gray-200/50 rounded animate-pulse mb-2"></div>
                <div className="h-4 w-48 bg-gray-200/50 rounded animate-pulse"></div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5, 6].map((j) => (
                    <div key={j} className="flex items-start space-x-3 p-3">
                      <div className="h-8 w-8 bg-gray-200/50 rounded-lg animate-pulse"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-3/4 bg-gray-200/50 rounded animate-pulse"></div>
                        <div className="h-3 w-full bg-gray-200/50 rounded animate-pulse"></div>
                        <div className="h-3 w-1/2 bg-gray-200/50 rounded animate-pulse"></div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}