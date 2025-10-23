"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/utils/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Clock, Loader2, Calendar, MapPin, User, Mail } from "lucide-react";

interface VerificationResult {
  success: boolean;
  message: string;
  registration?: {
    event: {
      _id: string;
      title: string;
      startDate: string;
      venue: string;
    };
    user: {
      _id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
    verifiedAt: string;
  };
  ticketGenerated?: boolean;
}

export default function RSVPVerificationPage() {
  const { token } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const verifyRSVP = async () => {
      try {
        setLoading(true);
        // Use the correct API endpoint - adjust based on your actual API structure
        const response = await api.get(`/events/rsvp/verify/${token}`);
        
        if (response.data.success) {
          setResult(response.data);
        } else {
          setError(response.data.message || "Verification failed");
        }
      } catch (err: any) {
        console.error("Verification error:", err);
        setError(err.response?.data?.message || "Invalid or expired verification link");
      } finally {
        setLoading(false);
      }
    };

    if (token) {
      verifyRSVP();
    }
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg border-0">
          <CardContent className="p-8 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Verifying Your RSVP</h2>
            <p className="text-gray-600">Please wait while we confirm your attendance...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-lg border-0">
        <CardHeader className="text-center pb-4">
          {result?.success ? (
            <>
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <CardTitle className="text-2xl text-green-600">RSVP Confirmed!</CardTitle>
              <CardDescription className="text-gray-600 text-base">
                Thank you for confirming your attendance
              </CardDescription>
            </>
          ) : (
            <>
              <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <XCircle className="h-8 w-8 text-red-600" />
              </div>
              <CardTitle className="text-2xl text-red-600">Verification Failed</CardTitle>
              <CardDescription className="text-gray-600 text-base">
                {error || "Unable to verify your RSVP"}
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {result?.success && result.registration && (
            <>
              {/* Event Details */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 text-left">
                <h3 className="font-semibold text-blue-900 mb-2 flex items-center">
                  <Calendar className="h-4 w-4 mr-2" />
                  Event Details
                </h3>
                <p className="text-blue-800 font-medium">{result.registration.event.title}</p>
                <p className="text-blue-700 text-sm flex items-center mt-1">
                  <MapPin className="h-3 w-3 mr-1" />
                  {result.registration.event.venue}
                </p>
                <p className="text-blue-700 text-sm">
                  {new Date(result.registration.event.startDate).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>

              {/* User Details */}
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-left">
                <h3 className="font-semibold text-gray-900 mb-2 flex items-center">
                  <User className="h-4 w-4 mr-2" />
                  Attendee Information
                </h3>
                <p className="text-gray-800 font-medium">
                  {result.registration.user.firstName} {result.registration.user.lastName}
                </p>
                <p className="text-gray-700 text-sm flex items-center mt-1">
                  <Mail className="h-3 w-3 mr-1" />
                  {result.registration.user.email}
                </p>
              </div>

              {/* Confirmation Details */}
              <div className="space-y-2">
                <Badge className="bg-green-100 text-green-800 border-green-200">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Confirmed on {new Date(result.registration.verifiedAt).toLocaleDateString()}
                </Badge>
                
                {result.ticketGenerated && (
                  <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                    <p className="text-sm text-green-700">
                      <strong>Ticket Generated!</strong> Check your email for your event ticket and further instructions.
                    </p>
                  </div>
                )}

                {!result.ticketGenerated && (
                  <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
                    <p className="text-sm text-blue-700">
                      Your ticket will be generated and sent to you closer to the event date.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {error && error.includes("expired") && (
            <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
              <p className="text-sm text-amber-700">
                <strong>Link Expired:</strong> This verification link has expired. Please contact the event organizer for a new link.
              </p>
            </div>
          )}

          {error && error.includes("already verified") && (
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-700">
                <strong>Already Confirmed:</strong> Your attendance was already confirmed on {result?.registration?.verifiedAt ? new Date(result.registration.verifiedAt).toLocaleDateString() : 'a previous date'}.
              </p>
            </div>
          )}
          
          <div className="space-y-2 pt-4">
            <Button
              onClick={() => router.push('/')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              Return to Home
            </Button>
            <Button
              onClick={() => router.push('/events')}
              variant="outline"
              className="w-full border-blue-200 text-blue-700 hover:bg-blue-50"
            >
              Browse More Events
            </Button>
          </div>

          {/* Support Information */}
          <div className="pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-500">
              Need help? Contact the event organizer or support team.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}