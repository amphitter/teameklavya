"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/utils/api";

interface RegistrationResponse {
  _id: string;
  userId: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  answers: Array<{
    fieldLabel: string;
    fieldType: string;
    value: any;
  }>;
  createdAt: string;
}

interface Event {
  _id: string;
  title: string;
  startDate: string;
}

export default function EventRegistrationsPage() {
  const { id } = useParams();
  const [registrations, setRegistrations] = useState<RegistrationResponse[]>([]);
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchRegistrations();
    fetchEvent();
  }, [id]);

  const fetchRegistrations = async () => {
    try {
      const res = await api.get(`/registration/responses/${id}`);
      if (res.data.success) {
        setRegistrations(res.data.responses);
      }
    } catch (error) {
      console.error("Error fetching registrations:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEvent = async () => {
    try {
      const res = await api.get(`/events/${id}`);
      if (res.data.success) {
        setEvent(res.data.event);
      }
    } catch (error) {
      console.error("Error fetching event:", error);
    }
  };

  const exportToCSV = async () => {
    setExporting(true);
    try {
      const res = await api.get(`/registration/responses/${id}/export`, {
        responseType: 'blob'
      });
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `registrations-${event?.title}-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error("Error exporting CSV:", error);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-purple-600 text-white">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold">Registrations</h1>
                <p className="text-blue-100 mt-1">{event?.title}</p>
              </div>
              <button
                onClick={exportToCSV}
                disabled={exporting || registrations.length === 0}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-blue-600 bg-white hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {exporting ? "Exporting..." : `Export CSV (${registrations.length})`}
              </button>
            </div>
          </div>

          {/* Registrations List */}
          <div className="p-6">
            {registrations.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-400 text-6xl mb-4">📝</div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No registrations yet</h3>
                <p className="text-gray-500">Registrations will appear here once users sign up for your event.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {registrations.map((registration) => (
                  <div key={registration._id} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {registration.userId.firstName} {registration.userId.lastName}
                        </h3>
                        <p className="text-gray-600 text-sm">{registration.userId.email}</p>
                      </div>
                      <span className="text-xs text-gray-500">
                        {new Date(registration.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                      {registration.answers.map((answer, index) => (
                        <div key={index}>
                          <span className="font-medium text-gray-700">{answer.fieldLabel}:</span>
                          <span className="ml-2 text-gray-600">
                            {typeof answer.value === 'boolean' 
                              ? (answer.value ? 'Yes' : 'No')
                              : answer.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}