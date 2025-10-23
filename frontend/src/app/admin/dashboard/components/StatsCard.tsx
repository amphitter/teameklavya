"use client";
import { useEffect, useState } from "react";
import { api } from "@/utils/api";

interface Stats {
  totalUsers: number;
  totalEvents: number;
  activeParticipants: number;
}

export default function StatsCard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await api.get("/admin/stats", {
          headers: { Authorization: `Bearer ${token}` },
        });
        setStats(res.data);
      } catch (err) {
        console.error("Failed to fetch stats", err);
      }
    };

    fetchStats();
  }, []);

  if (!stats) return <p>📡 Fetching stats...</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-blue-100 p-4 rounded shadow">
        <h3 className="text-lg font-semibold">Total Users</h3>
        <p className="text-2xl font-bold">{stats.totalUsers}</p>
      </div>
      <div className="bg-green-100 p-4 rounded shadow">
        <h3 className="text-lg font-semibold">Total Events</h3>
        <p className="text-2xl font-bold">{stats.totalEvents}</p>
      </div>
      <div className="bg-yellow-100 p-4 rounded shadow">
        <h3 className="text-lg font-semibold">Active Participants</h3>
        <p className="text-2xl font-bold">{stats.activeParticipants}</p>
      </div>
    </div>
  );
}
