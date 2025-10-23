// app/admin/users/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { jwtDecode } from "jwt-decode";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Users, 
  Download, 
  Filter,
  Search,
  User,
  Mail,
  Building,
  BookOpen,
  Calendar,
  Shield,
  Eye,
  MoreHorizontal,
  ArrowLeft
} from "lucide-react";
import { toast } from "sonner";

interface DecodedToken {
  id: string;
  role: string;
  exp: number;
}

interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  profile?: {
    institution?: string;
    course?: string;
    year?: string;
  };
  createdAt: string;
  emailVerified: boolean;
  pastEventsAttended?: string[];
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterInstitution, setFilterInstitution] = useState("all");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/login");
      return;
    }

    try {
      const decoded: DecodedToken = jwtDecode(token);
      if (decoded.exp * 1000 < Date.now() || decoded.role !== "admin") {
        localStorage.clear();
        router.replace("/login");
        return;
      }
      fetchUsers();
    } catch (err) {
      console.error("Token decoding failed:", err);
      localStorage.clear();
      router.replace("/login");
    }
  }, [router]);

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await api.get("/admin/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUsers(res.data.users);
      setFilteredUsers(res.data.users);
    } catch (err: any) {
      console.error("Failed to fetch users", err);
      toast.error(err.response?.data?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let result = users;

    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(
        (user) =>
          user.firstName.toLowerCase().includes(lower) ||
          user.lastName.toLowerCase().includes(lower) ||
          user.email.toLowerCase().includes(lower) ||
          user.profile?.institution?.toLowerCase().includes(lower) ||
          user.profile?.course?.toLowerCase().includes(lower)
      );
    }

    if (filterRole !== "all") {
      result = result.filter((user) => user.role === filterRole);
    }

    if (filterInstitution !== "all") {
      result = result.filter((user) => user.profile?.institution === filterInstitution);
    }

    setFilteredUsers(result);
  }, [searchTerm, filterRole, filterInstitution, users]);

  const handleExport = () => {
    const token = localStorage.getItem("token");
    window.open(`${process.env.NEXT_PUBLIC_API_URL}/admin/users/export?token=${token}`, "_blank");
    toast.success("Exporting users data...");
  };

  const getUniqueInstitutions = () => {
    const institutions = users.map(u => u.profile?.institution).filter(Boolean) as string[];
    return Array.from(new Set(institutions));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-64 mb-6"></div>
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-lg shadow p-6">
                  <div className="flex space-x-4">
                    <div className="w-12 h-12 bg-gray-200 rounded-full"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 text-white shadow-2xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between">
            <div className="flex items-center space-x-4 mb-4 md:mb-0">
              <Button
                variant="ghost"
                onClick={() => router.push('/admin/dashboard')}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
              <div className="space-y-2">
                <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-white to-blue-100 bg-clip-text text-transparent">
                  User Management
                </h1>
                <p className="text-blue-100">Manage and monitor all platform users</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button 
                onClick={handleExport}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm transition-all duration-200"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-600 mb-1">Total Users</p>
                  <p className="text-3xl font-bold text-gray-900">{users.length}</p>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 p-3 shadow-lg">
                  <Users className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-600 mb-1">Verified</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {users.filter(u => u.emailVerified).length}
                  </p>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 p-3 shadow-lg">
                  <Shield className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-600 mb-1">Admins</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {users.filter(u => u.role === 'admin').length}
                  </p>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 p-3 shadow-lg">
                  <User className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-600 mb-1">Active</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {users.filter(u => u.pastEventsAttended && u.pastEventsAttended.length > 0).length}
                  </p>
                </div>
                <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 p-3 shadow-lg">
                  <Calendar className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl mb-6">
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="flex flex-col sm:flex-row gap-4 flex-1">
                {/* Search */}
                <div className="relative flex-1 sm:flex-initial">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 pr-4 py-2 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full sm:w-64 bg-white/50 transition-all duration-200"
                  />
                </div>

                {/* Role Filter */}
                <div className="relative">
                  <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <select
                    value={filterRole}
                    onChange={(e) => setFilterRole(e.target.value)}
                    className="pl-10 pr-8 py-2 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/50 transition-all duration-200 appearance-none cursor-pointer"
                  >
                    <option value="all">All Roles</option>
                    <option value="user">Users</option>
                    <option value="admin">Admins</option>
                  </select>
                </div>

                {/* Institution Filter */}
                <div className="relative">
                  <Building className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <select
                    value={filterInstitution}
                    onChange={(e) => setFilterInstitution(e.target.value)}
                    className="pl-10 pr-8 py-2 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white/50 transition-all duration-200 appearance-none cursor-pointer"
                  >
                    <option value="all">All Institutions</option>
                    {getUniqueInstitutions().map(institution => (
                      <option key={institution} value={institution}>
                        {institution}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="text-sm font-semibold text-gray-600 bg-white/50 px-4 py-2 rounded-xl border border-gray-200">
                Showing {filteredUsers.length} of {users.length} users
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Users Table */}
        <Card className="border border-gray-200/60 bg-white/70 backdrop-blur-sm shadow-lg rounded-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center space-x-2">
              <Users className="h-6 w-6 text-blue-600" />
              <span>Registered Users</span>
            </CardTitle>
            <CardDescription className="text-gray-600">
              Manage all platform users and their profiles
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Profile</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <User className="h-8 w-8 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No users found</h3>
                        <p className="text-gray-600">
                          {users.length === 0 
                            ? "No users have registered yet." 
                            : "Try adjusting your search or filter criteria."}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => (
                      <tr key={user._id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                              {user.firstName[0]}{user.lastName[0]}
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-gray-900">
                                {user.firstName} {user.lastName}
                              </div>
                              <div className="text-sm text-gray-500 flex items-center">
                                <Mail className="h-3 w-3 mr-1" />
                                {user.email}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900 space-y-1">
                            {user.profile?.institution && (
                              <div className="flex items-center">
                                <Building className="h-3 w-3 mr-2 text-gray-400" />
                                {user.profile.institution}
                              </div>
                            )}
                            {user.profile?.course && (
                              <div className="flex items-center">
                                <BookOpen className="h-3 w-3 mr-2 text-gray-400" />
                                {user.profile.course}
                              </div>
                            )}
                            {user.profile?.year && (
                              <div className="flex items-center">
                                <Calendar className="h-3 w-3 mr-2 text-gray-400" />
                                {user.profile.year}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="space-y-2">
                            <Badge 
                              variant={user.role === 'admin' ? 'default' : 'outline'}
                              className={user.role === 'admin' ? 'bg-purple-100 text-purple-800 border-purple-200' : ''}
                            >
                              {user.role}
                            </Badge>
                            <div>
                              {user.emailVerified ? (
                                <Badge variant="success" className="text-xs">
                                  Verified
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 border-yellow-200">
                                  Pending
                                </Badge>
                              )}
                            </div>
                            {user.pastEventsAttended && user.pastEventsAttended.length > 0 && (
                              <div className="text-xs text-gray-500">
                                {user.pastEventsAttended.length} events attended
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">
                            {formatDate(user.createdAt)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {new Date(user.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                              title="View User"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                              title="More Options"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}