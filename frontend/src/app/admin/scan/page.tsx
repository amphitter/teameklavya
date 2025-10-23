// app/admin/scan/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { jwtDecode } from "jwt-decode";
import { BrowserQRCodeReader } from "@zxing/browser";
import type { Result } from "@zxing/library";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  QrCode, 
  Camera, 
  CameraOff, 
  CheckCircle, 
  User, 
  Calendar, 
  MapPin,
  Clock,
  ArrowLeft,
  RotateCcw,
  Scan,
  Ticket,
  RefreshCw,
  Loader2,
  Smartphone,
  History,
  Info
} from "lucide-react";
import { toast } from "sonner";

interface DecodedToken {
  id: string;
  role: string;
  exp: number;
}

interface ScannedTicket {
  _id: string;
  eventId: {
    _id: string;
    title: string;
    startDate: string;
    endDate: string;
    venue: string;
  };
  userId: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    profile?: {
      institution?: string;
      course?: string;
      year?: string;
    };
  };
  qrCode: string;
  token: string;
  checkedIn: boolean;
  checkInTime?: string;
  checkOutTime?: string;
  createdAt: string;
}

interface QRCodeData {
  ticketId: string;
  eventId: string;
  userId: string;
  type: string;
}

export default function TicketScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [scannedTicket, setScannedTicket] = useState<ScannedTicket | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [scanHistory, setScanHistory] = useState<ScannedTicket[]>([]);
  const [manualToken, setManualToken] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const codeReader = useRef<BrowserQRCodeReader | null>(null);
  const controlRef = useRef<any>(null);
  const scanCooldownRef = useRef(false);
  const lastProcessedTokenRef = useRef<string>("");
  const scanningRef = useRef(false);
  const isMountedRef = useRef(true);

  // Check if mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    // Check admin authentication
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
    } catch (err) {
      console.error("Token decoding failed:", err);
      localStorage.clear();
      router.replace("/login");
    }

    // Initialize QR code reader
    codeReader.current = new BrowserQRCodeReader();

    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, [router]);

  // Keep ref in sync with state
  useEffect(() => {
    scanningRef.current = scanning;
  }, [scanning]);

  const initializeCamera = async (): Promise<MediaStream> => {
    if (!isMountedRef.current) throw new Error("Component unmounted");

    setCameraLoading(true);
    
    try {
      const constraints = {
        video: { 
          facingMode: "environment",
          width: { ideal: isMobile ? 720 : 1280 },
          height: { ideal: isMobile ? 480 : 720 }
        },
        audio: false
      };
      
      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      return mediaStream;
    } catch (err) {
      setCameraLoading(false);
      throw err;
    }
  };

  const startCamera = async () => {
    if (!isMountedRef.current) return;

    try {
      setCameraLoading(true);
      setScanning(false);
      scanningRef.current = false;

      // Stop any existing camera first
      if (stream) {
        stopCamera();
        // Add a small delay to ensure clean restart
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      const mediaStream = await initializeCamera();
      
      if (!isMountedRef.current) {
        mediaStream.getTracks().forEach(track => track.stop());
        return;
      }

      setStream(mediaStream);
      setCameraActive(true);

      // Wait for video element to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        
        // Wait for video to load and play
        try {
          await videoRef.current.play();
          
          if (!isMountedRef.current) return;
          
          setScanning(true);
          scanningRef.current = true;
          await startQRScanning();
        } catch (playError) {
          console.error("Video play failed:", playError);
          if (isMountedRef.current) {
            toast.error("Failed to start camera preview");
          }
        }
      }

      setCameraLoading(false);
    } catch (err) {
      console.error("Camera start error:", err);
      if (isMountedRef.current) {
        setCameraLoading(false);
        setLoading(false);
        
        if (err instanceof Error) {
          switch (err.name) {
            case 'NotAllowedError':
              toast.error("Camera permission denied. Please allow camera access in your browser settings.");
              break;
            case 'NotFoundError':
              toast.error("No suitable camera found. Please check your device camera.");
              break;
            default:
              toast.error("Cannot access camera. Please check permissions and try again.");
          }
        }
      }
    }
  };

  const stopCamera = () => {
    // Stop QR code scanning first
    if (controlRef.current) {
      try {
        controlRef.current.stop();
      } catch (e) {
        console.warn("Error stopping QR reader:", e);
      }
      controlRef.current = null;
    }
    
    // Stop video stream
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
      });
      setStream(null);
    }
    
    // Clear video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    if (isMountedRef.current) {
      setCameraActive(false);
      setScanning(false);
      scanningRef.current = false;
      setCameraLoading(false);
    }
  };

  const startQRScanning = async () => {
    if (!videoRef.current || !codeReader.current || !isMountedRef.current) {
      return;
    }

    try {
      // Reset cooldown when starting new scanning session
      scanCooldownRef.current = false;
      lastProcessedTokenRef.current = "";

      controlRef.current = await codeReader.current.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result: Result | undefined, error: Error | undefined) => {
          if (result && isMountedRef.current) {
            handleQRCodeDetected(result.getText());
          }
          if (error && !error.message?.includes("No QR code found") && isMountedRef.current) {
            console.debug("QR scanning error:", error);
          }
        }
      );
    } catch (error) {
      console.error("QR scanning setup error:", error);
      if (isMountedRef.current) {
        setScanning(false);
        scanningRef.current = false;
      }
    }
  };

  const handleQRCodeDetected = (qrData: string) => {
    if (scanCooldownRef.current || !isMountedRef.current) {
      return;
    }

    scanCooldownRef.current = true;
    
    try {
      let token = qrData.trim();
      
      // Try to parse as JSON to extract ticketId
      try {
        const qrDataObj: QRCodeData = JSON.parse(qrData);
        if (qrDataObj.ticketId) {
          token = qrDataObj.ticketId;
        }
      } catch (parseError) {
        // QR data is not JSON, use as direct token
      }
      
      if (token && token.length > 10) {
        // Check if this is the same token we just processed
        if (token === lastProcessedTokenRef.current) {
          setTimeout(() => {
            if (isMountedRef.current) {
              scanCooldownRef.current = false;
            }
          }, 1000);
          return;
        }
        
        lastProcessedTokenRef.current = token;
        processTicketScan(token);
      } else {
        toast.error("Invalid QR code format");
        resetScanCooldown();
      }
    } catch (error) {
      console.error("Error processing QR code:", error);
      toast.error("Error processing QR code");
      resetScanCooldown();
    }
  };

  const resetScanCooldown = () => {
    setTimeout(() => {
      if (isMountedRef.current) {
        scanCooldownRef.current = false;
      }
    }, 1500);
  };

  const processTicketScan = async (token: string) => {
    if (!isMountedRef.current) return;

    setLoading(true);
    
    try {
      const adminToken = localStorage.getItem("token");
      
      const response = await api.get(`/tickets/token/${encodeURIComponent(token)}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      if (response.data.success) {
        const ticket = response.data.ticket;
        setScannedTicket(ticket);
        
        // Update scan history without duplicates
        setScanHistory(prev => {
          const filtered = prev.filter(t => t._id !== ticket._id);
          return [ticket, ...filtered.slice(0, 4)];
        });
        
        toast.success("Ticket scanned successfully!");
        
        // Stop camera when ticket is found
        stopCamera();
        
        // Reset cooldown for next scan
        scanCooldownRef.current = false;
      } else {
        toast.error("Invalid ticket token");
        resetScanCooldown();
      }
    } catch (error: any) {
      console.error("Scan error:", error);
      const errorMessage = error.response?.data?.message || "Failed to scan ticket";
      toast.error(errorMessage);
      resetScanCooldown();
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const handleManualScan = async (token: string) => {
    if (!token.trim()) {
      toast.error("Please enter a ticket token");
      return;
    }

    // Stop camera if active for manual scan
    if (cameraActive) {
      stopCamera();
    }

    await processTicketScan(token);
  };

  const handleCheckIn = async () => {
    if (!scannedTicket) return;

    setLoading(true);
    try {
      const adminToken = localStorage.getItem("token");
      const response = await api.post(
        "/tickets/scan",
        {
          token: scannedTicket.token,
          action: "entry"
        },
        {
          headers: { Authorization: `Bearer ${adminToken}` },
        }
      );

      if (response.data.success) {
        const updatedTicket = response.data.ticket;
        setScannedTicket(updatedTicket);
        setScanHistory(prev => 
          prev.map(ticket => 
            ticket._id === updatedTicket._id ? updatedTicket : ticket
          )
        );
        toast.success("Check-in successful!");
      }
    } catch (error: any) {
      console.error("Check-in error:", error);
      toast.error(error.response?.data?.message || "Check-in failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (!scannedTicket) return;

    setLoading(true);
    try {
      const adminToken = localStorage.getItem("token");
      const response = await api.post(
        "/tickets/scan",
        {
          token: scannedTicket.token,
          action: "exit"
        },
        {
          headers: { Authorization: `Bearer ${adminToken}` },
        }
      );

      if (response.data.success) {
        const updatedTicket = response.data.ticket;
        setScannedTicket(updatedTicket);
        setScanHistory(prev => 
          prev.map(ticket => 
            ticket._id === updatedTicket._id ? updatedTicket : ticket
          )
        );
        toast.success("Check-out successful!");
      }
    } catch (error: any) {
      console.error("Check-out error:", error);
      toast.error(error.response?.data?.message || "Check-out failed");
    } finally {
      setLoading(false);
    }
  };

  const resetScan = () => {
    setScannedTicket(null);
    setManualToken("");
    scanCooldownRef.current = false;
    lastProcessedTokenRef.current = "";
    
    if (!cameraActive) {
      startCamera();
    } else {
      setScanning(true);
      scanningRef.current = true;
    }
  };

  const quickRefresh = async () => {
    if (cameraActive) {
      stopCamera();
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await startCamera();
  };

  const switchCamera = async () => {
    if (!stream) return;

    try {
      stopCamera();
      await new Promise(resolve => setTimeout(resolve, 500));
      await startCamera();
    } catch (error) {
      console.error("Error switching camera:", error);
      toast.error("Failed to switch camera");
    }
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 pb-8">
      {/* Modern Header */}
      <div className="bg-white/80 backdrop-blur-md border-b border-gray-200/60 text-gray-900 shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col space-y-4">
            {/* Top Navigation */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Button
                  variant="ghost"
                  size={isMobile ? "sm" : "default"}
                  onClick={() => router.push('/admin/dashboard')}
                  className="text-gray-600 hover:text-gray-900 hover:bg-gray-100/80"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {isMobile ? "Back" : "Dashboard"}
                </Button>
                {isMobile && (
                  <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
                    <Smartphone className="h-3 w-3 mr-1" />
                    Mobile
                  </Badge>
                )}
              </div>
              
              <div className="flex gap-2">
                {cameraActive ? (
                  <>
                    <Button
                      onClick={quickRefresh}
                      size={isMobile ? "sm" : "default"}
                      variant="outline"
                      disabled={cameraLoading}
                      className="border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      {cameraLoading ? (
                        <Loader2 className="h-4 w-4" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      {!isMobile && "Refresh"}
                    </Button>
                    <Button
                      onClick={switchCamera}
                      size={isMobile ? "sm" : "default"}
                      variant="outline"
                      disabled={cameraLoading}
                      className="border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      {!isMobile && "Switch"}
                    </Button>
                    <Button
                      onClick={stopCamera}
                      size={isMobile ? "sm" : "default"}
                      variant="outline"
                      disabled={cameraLoading}
                      className="border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      <CameraOff className="h-4 w-4" />
                      {!isMobile && "Stop"}
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={startCamera}
                    size={isMobile ? "sm" : "default"}
                    disabled={cameraLoading}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {cameraLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Camera className="h-4 w-4 mr-2" />
                    )}
                    {cameraLoading ? "Starting..." : "Start Camera"}
                  </Button>
                )}
              </div>
            </div>

            {/* Page Title */}
            <div className="text-center space-y-2">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Ticket Scanner
              </h1>
              <p className="text-gray-600 text-sm max-w-2xl mx-auto">
                Scan QR codes to check attendees in and out of events
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
          {/* Scanner Section */}
          <div className="xl:col-span-2 space-y-6">
            {/* Camera Preview Card */}
            <Card className="border border-gray-200 bg-white shadow-sm rounded-xl overflow-hidden">
              <CardHeader className="pb-4 border-b border-gray-100">
                <CardTitle className="flex items-center justify-between text-lg font-semibold">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <QrCode className="h-5 w-5 text-blue-600" />
                    </div>
                    <span>QR Code Scanner</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    {scanning && (
                      <Badge variant="default" className="bg-green-100 text-green-700 border-green-200">
                        <Scan className="h-3 w-3 mr-1" />
                        {isMobile ? "Live" : "Scanning"}
                      </Badge>
                    )}
                    {cameraLoading && (
                      <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 border-yellow-200">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        {isMobile ? "Loading" : "Initializing"}
                      </Badge>
                    )}
                  </div>
                </CardTitle>
                <CardDescription className="text-gray-600">
                  {cameraLoading 
                    ? "Camera is initializing..." 
                    : scanning 
                    ? "Position the camera to scan a QR code" 
                    : cameraActive 
                    ? "Camera ready - positioning scanner" 
                    : "Start camera to begin scanning tickets"
                  }
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {/* Camera Feed */}
                <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-[4/3] flex items-center justify-center border border-gray-800">
                  {cameraActive ? (
                    <>
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                        style={{ transform: 'scaleX(-1)' }}
                      />
                      {/* Scanner Overlay */}
                      <div className="absolute inset-0 border-2 border-blue-400/50 m-6 rounded-lg"></div>
                      
                      {/* Scanner Corners */}
                      <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-blue-400"></div>
                      <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-blue-400"></div>
                      <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-blue-400"></div>
                      <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-blue-400"></div>

                      {/* Status Indicator */}
                      <div className={`absolute top-4 left-4 px-3 py-1.5 rounded-full text-xs font-medium ${
                        scanning ? 'bg-green-500 text-white' : 
                        cameraLoading ? 'bg-yellow-500 text-white' : 'bg-blue-500 text-white'
                      }`}>
                        {cameraLoading ? (
                          <Loader2 className="h-3 w-3 inline mr-1.5 animate-spin" />
                        ) : (
                          <Scan className="h-3 w-3 inline mr-1.5" />
                        )}
                        {cameraLoading ? "Loading" : scanning ? "Scanning" : "Ready"}
                      </div>

                      {/* Scanning Animation */}
                      {scanning && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-40 h-40 border-2 border-blue-400/30 rounded-lg animate-pulse"></div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center text-white p-8">
                      <div className="bg-white/10 rounded-xl p-6 inline-block backdrop-blur-sm">
                        <CameraOff className="h-12 w-12 mx-auto mb-4 opacity-70" />
                        <p className="text-lg font-semibold mb-2">Camera Inactive</p>
                        <p className="text-gray-300 mb-4 max-w-xs">
                          Start camera to begin scanning QR codes from tickets
                        </p>
                        <Button
                          onClick={startCamera}
                          disabled={cameraLoading}
                          className="bg-white/20 hover:bg-white/30 text-white border-white/30"
                          size={isMobile ? "sm" : "default"}
                        >
                          {cameraLoading ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Camera className="h-4 w-4 mr-2" />
                          )}
                          {cameraLoading ? "Starting..." : "Start Camera"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Manual Token Input */}
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center text-sm">
                    <div className="p-1.5 bg-blue-100 rounded-lg mr-2">
                      <Ticket className="h-4 w-4 text-blue-600" />
                    </div>
                    Manual Token Entry
                  </h3>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="text"
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      placeholder="Enter ticket token here..."
                      className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleManualScan(manualToken);
                        }
                      }}
                    />
                    <Button
                      onClick={() => handleManualScan(manualToken)}
                      disabled={loading || !manualToken.trim()}
                      className="bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
                      size={isMobile ? "sm" : "default"}
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Scan className="h-4 w-4 mr-2" />
                      )}
                      {loading ? "Scanning..." : "Scan Token"}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2 flex items-center">
                    <Info className="h-3 w-3 mr-1" />
                    Enter ticket token manually or scan QR code automatically
                  </p>
                </div>

                {/* Scanner Status */}
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700 flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-2 ${
                        scanning ? 'bg-green-500 animate-pulse' : 
                        cameraActive ? 'bg-blue-500' : 'bg-gray-400'
                      }`}></div>
                      Scanner Status
                    </span>
                    <Badge 
                      variant="outline"
                      className={
                        scanning ? "bg-green-50 text-green-700 border-green-200" : 
                        cameraActive ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-50 text-gray-600 border-gray-200"
                      }
                    >
                      {scanning ? "Active" : cameraActive ? "Ready" : "Inactive"}
                    </Badge>
                  </div>
                  {scanCooldownRef.current && (
                    <div className="mt-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded border border-amber-200 flex items-center">
                      <Clock className="h-3 w-3 mr-1" />
                      Scan cooldown active - please wait before next scan
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Recent Scans */}
            {scanHistory.length > 0 && (
              <Card className="border border-gray-200 bg-white shadow-sm rounded-xl">
                <CardHeader className="pb-4 border-b border-gray-100">
                  <CardTitle className="flex items-center space-x-3 text-lg font-semibold">
                    <div className="p-2 bg-purple-50 rounded-lg">
                      <History className="h-5 w-5 text-purple-600" />
                    </div>
                    <span>Recent Scans</span>
                    <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                      {scanHistory.length}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-gray-600">
                    Last {scanHistory.length} scanned tickets
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-3 max-h-60 overflow-y-auto">
                    {scanHistory.map((ticket) => (
                      <div
                        key={`${ticket._id}-${ticket.checkInTime || ticket.createdAt}`}
                        className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => {
                          setScannedTicket(ticket);
                          stopCamera();
                        }}
                      >
                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                            ticket.checkedIn && !ticket.checkOutTime ? 'bg-green-500' :
                            ticket.checkOutTime ? 'bg-blue-500' : 'bg-gray-300'
                          }`}></div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 text-sm truncate">
                              {ticket.userId.firstName} {ticket.userId.lastName}
                            </p>
                            <p className="text-gray-500 text-xs truncate">{ticket.eventId.title}</p>
                            {ticket.checkInTime && (
                              <p className="text-gray-400 text-xs flex items-center">
                                <Clock className="h-3 w-3 mr-1" />
                                {formatTime(ticket.checkInTime)}
                              </p>
                            )}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            ticket.checkedIn && !ticket.checkOutTime ? "bg-green-50 text-green-700 border-green-200" :
                            ticket.checkOutTime ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-50 text-gray-600 border-gray-200"
                          }
                        >
                          {ticket.checkedIn && !ticket.checkOutTime ? "Checked In" :
                           ticket.checkOutTime ? "Checked Out" : "Pending"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Ticket Details Sidebar */}
          <div className="space-y-6">
            <Card className="border border-gray-200 bg-white shadow-sm rounded-xl sticky top-6">
              <CardHeader className="pb-4 border-b border-gray-100">
                <CardTitle className="flex items-center justify-between text-lg font-semibold">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-green-50 rounded-lg">
                      <Ticket className="h-5 w-5 text-green-600" />
                    </div>
                    <span>Ticket Details</span>
                  </div>
                  {scannedTicket && (
                    <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200 text-xs">
                      {scanHistory.find(t => t._id === scannedTicket._id) ? 'Scanned' : 'Manual Entry'}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-gray-600">
                  {scannedTicket ? "Scanned ticket information" : "Scan a ticket to view details"}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                {scannedTicket ? (
                  <div className="space-y-6">
                    {/* Event Information */}
                    <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
                      <h3 className="font-semibold text-gray-900 text-base mb-3 flex items-center">
                        <Calendar className="h-4 w-4 text-blue-600 mr-2" />
                        {scannedTicket.eventId.title}
                      </h3>
                      <div className="space-y-2 text-sm text-gray-600">
                        <div className="flex items-center space-x-2">
                          <Calendar className="h-4 w-4 text-blue-500" />
                          <span>
                            {formatDateTime(scannedTicket.eventId.startDate)}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <MapPin className="h-4 w-4 text-green-500" />
                          <span>{scannedTicket.eventId.venue}</span>
                        </div>
                      </div>
                    </div>

                    {/* Attendee Information */}
                    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                      <h4 className="font-semibold text-gray-900 mb-3 flex items-center text-sm">
                        <User className="h-4 w-4 text-purple-600 mr-2" />
                        Attendee Information
                      </h4>
                      <div className="space-y-3 text-sm">
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="font-medium text-gray-700">Name:</span>
                          <span className="text-gray-900">
                            {scannedTicket.userId.firstName} {scannedTicket.userId.lastName}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-1 border-b border-gray-100">
                          <span className="font-medium text-gray-700">Email:</span>
                          <span className="text-gray-900 truncate max-w-[140px]">
                            {scannedTicket.userId.email}
                          </span>
                        </div>
                        {scannedTicket.userId.profile?.institution && (
                          <div className="flex justify-between items-center py-1">
                            <span className="font-medium text-gray-700">Institution:</span>
                            <span className="text-gray-900 text-right max-w-[140px]">
                              {scannedTicket.userId.profile.institution}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Ticket Status */}
                    <div className="bg-indigo-50 rounded-lg border border-indigo-200 p-4">
                      <h4 className="font-semibold text-gray-900 mb-3 flex items-center text-sm">
                        <div className="w-2 h-2 rounded-full bg-blue-500 mr-2"></div>
                        Ticket Status
                      </h4>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center bg-white rounded-lg p-3">
                          <span className="text-sm font-medium text-gray-700">Status:</span>
                          <Badge
                            variant="outline"
                            className={
                              scannedTicket.checkedIn && !scannedTicket.checkOutTime ? "bg-green-50 text-green-700 border-green-200" :
                              scannedTicket.checkOutTime ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-gray-50 text-gray-600 border-gray-200"
                            }
                          >
                            {scannedTicket.checkedIn && !scannedTicket.checkOutTime ? "Checked In" :
                             scannedTicket.checkOutTime ? "Checked Out" : "Not Checked In"}
                          </Badge>
                        </div>
                        
                        {scannedTicket.checkInTime && (
                          <div className="flex justify-between items-center text-sm">
                            <span className="font-medium text-gray-700">Check-in Time:</span>
                            <span className="text-gray-600">
                              {formatTime(scannedTicket.checkInTime)}
                            </span>
                          </div>
                        )}
                        
                        {scannedTicket.checkOutTime && (
                          <div className="flex justify-between items-center text-sm">
                            <span className="font-medium text-gray-700">Check-out Time:</span>
                            <span className="text-gray-600">
                              {formatTime(scannedTicket.checkOutTime)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="space-y-3">
                      {!scannedTicket.checkedIn ? (
                        <Button
                          onClick={handleCheckIn}
                          disabled={loading}
                          className="w-full bg-green-600 hover:bg-green-700 text-white py-2.5"
                          size="lg"
                        >
                          {loading ? (
                            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          ) : (
                            <CheckCircle className="h-5 w-5 mr-2" />
                          )}
                          {loading ? "Processing..." : "Check In Attendee"}
                        </Button>
                      ) : !scannedTicket.checkOutTime ? (
                        <Button
                          onClick={handleCheckOut}
                          disabled={loading}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5"
                          size="lg"
                        >
                          {loading ? (
                            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          ) : (
                            <CheckCircle className="h-5 w-5 mr-2" />
                          )}
                          {loading ? "Processing..." : "Check Out Attendee"}
                        </Button>
                      ) : (
                        <div className="text-center p-4 bg-green-50 rounded-lg border border-green-200">
                          <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
                          <p className="text-gray-700 font-medium text-sm">Ticket Fully Processed</p>
                          <p className="text-gray-500 text-xs mt-1">Attendee has been checked in and out</p>
                        </div>
                      )}
                      
                      <Button
                        onClick={resetScan}
                        variant="outline"
                        className="w-full border-gray-300 hover:bg-gray-50 text-gray-700 py-2.5"
                        size="lg"
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Scan Another Ticket
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <QrCode className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">No Ticket Scanned</h3>
                    <p className="text-gray-600 text-sm">
                      Scan a QR code or enter a token to view ticket details
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      {isMobile && cameraActive && (
        <div className="fixed bottom-4 left-4 right-4 bg-white/95 backdrop-blur-lg rounded-xl shadow-lg border border-gray-200 p-4 z-50">
          <div className="flex justify-between items-center">
            <Button
              onClick={quickRefresh}
              variant="outline"
              size="sm"
              className="flex-1 mx-1 bg-blue-50 border-blue-200 text-blue-700"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              onClick={switchCamera}
              variant="outline"
              size="sm"
              className="flex-1 mx-1 bg-green-50 border-green-200 text-green-700"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              onClick={stopCamera}
              variant="outline"
              size="sm"
              className="flex-1 mx-1 bg-red-50 border-red-200 text-red-700"
            >
              <CameraOff className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}