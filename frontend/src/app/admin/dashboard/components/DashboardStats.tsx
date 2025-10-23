"use client";

import { useEffect, useState } from "react";
import axios from "axios";

interface Stats {
  totalEvents: number;
  totalUsers: number;
  activeParticipants: number;
}

interface Props {
  token: string;
}

export default function DashboardStats({ token }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const eventsRes = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/events`);
      const usersRes = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_URL}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const totalEvents = eventsRes.data.events.length;
      const totalUsers = usersRes.data.users.length;

      // Active participants: users who have at least one registration
      const activeParticipants = usersRes.data.users.filter(
        (u: any) => u.pastEventsAttended && u.pastEventsAttended.length > 0
      ).length;

      setStats({ totalEvents, totalUsers, activeParticipants });
    } catch (err) {
      console.error(err);
    }
  };

  if (!stats) return <p>Loading stats...</p>;

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      <div className="bg-blue-500 text-white p-4 rounded shadow">
        <h3 className="text-lg font-bold">Total Events</h3>
        <p className="text-2xl">{stats.totalEvents}</p>
      </div>
      <div className="bg-green-500 text-white p-4 rounded shadow">
        <h3 className="text-lg font-bold">Total Users</h3>
        <p className="text-2xl">{stats.totalUsers}</p>
      </div>
      <div className="bg-yellow-500 text-white p-4 rounded shadow">
        <h3 className="text-lg font-bold">Active Participants</h3>
        <p className="text-2xl">{stats.activeParticipants}</p>
      </div>
    </div>
  );
}
