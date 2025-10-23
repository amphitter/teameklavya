"use client";
import { useEffect, useState } from "react";
import { api } from "@/utils/api";

interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  profile?: {
    institution?: string;
    course?: string;
    year?: string;
  };
}

export default function UsersTable() {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCourse, setFilterCourse] = useState("All");

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await api.get("/admin/users", {
          headers: { Authorization: `Bearer ${token}` },
        });
        setUsers(res.data.users);
        setFilteredUsers(res.data.users);
      } catch (err) {
        console.error("Failed to fetch users", err);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  // 🔍 Handle search
  useEffect(() => {
    let result = users;

    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(
        (user) =>
          user.firstName.toLowerCase().includes(lower) ||
          user.lastName.toLowerCase().includes(lower) ||
          user.email.toLowerCase().includes(lower)
      );
    }

    if (filterCourse !== "All") {
      result = result.filter(
        (user) => user.profile?.course?.toLowerCase() === filterCourse.toLowerCase()
      );
    }

    setFilteredUsers(result);
  }, [searchTerm, filterCourse, users]);

  const handleExport = () => {
    const token = localStorage.getItem("token");
    window.open(`${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/users/export?token=${token}`, "_blank");
  };

  if (loading) return <p>⏳ Loading users...</p>;

  // Extract unique courses for filter dropdown
    const uniqueCourses = Array.from(
    new Set(users.map((u) => u.profile?.course).filter(Boolean))
  );

  return (
    <div className="bg-white shadow rounded p-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
        <h2 className="text-xl font-bold">Registered Users</h2>

        <div className="flex flex-wrap items-center gap-3">
          {/* Search Bar */}
          <input
            type="text"
            placeholder="Search by name or email"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="border rounded px-3 py-1 w-48 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />

          {/* Filter Dropdown */}
          <select
            value={filterCourse}
            onChange={(e) => setFilterCourse(e.target.value)}
            className="border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="All">All Courses</option>
            {uniqueCourses.map((course) => (
              <option key={course} value={course || ""}>
                {course}
              </option>
            ))}
          </select>

          {/* Export Button */}
          <button
            onClick={handleExport}
            className="bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto">
        <table className="w-full table-auto border-collapse">
          <thead>
            <tr className="bg-gray-200 text-left">
              <th className="p-2">Name</th>
              <th className="p-2">Email</th>
              <th className="p-2">Institution</th>
              <th className="p-2">Course</th>
              <th className="p-2">Year</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length > 0 ? (
              filteredUsers.map((user) => (
                <tr key={user._id} className="border-t hover:bg-gray-50">
                  <td className="p-2">
                    {user.firstName} {user.lastName}
                  </td>
                  <td className="p-2">{user.email}</td>
                  <td className="p-2">{user.profile?.institution || "-"}</td>
                  <td className="p-2">{user.profile?.course || "-"}</td>
                  <td className="p-2">{user.profile?.year || "-"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="p-4 text-center text-gray-500">
                  No users found matching the criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
