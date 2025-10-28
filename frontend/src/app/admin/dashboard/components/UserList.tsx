"use client";

import { useEffect, useState } from "react";
import axios from "axios";

interface UserType {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  profile: {
    institution: string;
    course: string;
    year: string;
  };
  pastEventsAttended: string[];
}

interface Props {
  token: string;
}

export default function UserList({ token }: Props) {
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUsers(res.data.users);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <p>Loading users...</p>;
  if (!users.length) return <p>No registered users</p>;

  return (
    <div className="mt-6">
      <h2 className="text-xl font-bold mb-4">Registered Users</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full border rounded">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 border">Name</th>
              <th className="p-2 border">Email</th>
              <th className="p-2 border">Institution</th>
              <th className="p-2 border">Course</th>
              <th className="p-2 border">Year</th>
              <th className="p-2 border">Events Attended</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user._id} className="text-center">
                <td className="p-2 border">{user.firstName} {user.lastName}</td>
                <td className="p-2 border">{user.email}</td>
                <td className="p-2 border">{user.profile.institution}</td>
                <td className="p-2 border">{user.profile.course}</td>
                <td className="p-2 border">{user.profile.year}</td>
                <td className="p-2 border">{user.pastEventsAttended.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
