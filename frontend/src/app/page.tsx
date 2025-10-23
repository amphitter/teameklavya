"use client";
import { useEffect, useState } from "react";
import { api } from "@/utils/api";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Instagram, 
  Twitter, 
  Linkedin, 
  MessageCircle,
  Users,
  Calendar,
  ArrowRight,
  Play,
  Pause,
  Volume2,
  VolumeX,
  MapPin
} from "lucide-react";

export default function HomePage() {
  const [memberCount, setMemberCount] = useState(0);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [videoPlaying, setVideoPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [stats, setStats] = useState({
    members: 900,
    events: 0,
    communities: 12,
    projects: 45
  });

  const socialLinks = [
    {
      name: "Instagram",
      url: "https://www.instagram.com/iteameklavya",
      icon: Instagram,
      color: "hover:text-pink-600"
    },
    {
      name: "Twitter",
      url: "https://x.com/iteameklavya",
      icon: Twitter,
      color: "hover:text-blue-400"
    },
    {
      name: "LinkedIn",
      url: "https://www.linkedin.com/company/i-team-eklavya",
      icon: Linkedin,
      color: "hover:text-blue-600"
    },
    {
      name: "WhatsApp",
      url: "https://chat.whatsapp.com/L7HvHNOatFbHIWM7EGBaaA",
      icon: MessageCircle,
      color: "hover:text-green-500"
    }
  ];

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch events
        const eventsRes = await api.get("/events");
        const eventsData = eventsRes.data.events || [];
        setEvents(eventsData.slice(0, 3)); // Show only 3 latest events
        
        // Update stats with real event count
        setStats(prev => ({
          ...prev,
          events: eventsData.length
        }));

        // Simulate member count animation
        animateCounter(900, 1200, setMemberCount);
        
      } catch (err) {
        console.error("Failed to fetch data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const animateCounter = (target: number, duration: number, setter: (value: number) => void) => {
    let start = 0;
    const increment = target / (duration / 16); // 60fps
    
    const timer = setInterval(() => {
      start += increment;
      if (start >= target) {
        setter(target);
        clearInterval(timer);
      } else {
        setter(Math.floor(start));
      }
    }, 16);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const toggleVideo = () => {
    setVideoPlaying(!videoPlaying);
  };

  const toggleMute = () => {
    setMuted(!muted);
  };

  // Helper function to get proper image URLs
  const getImageUrl = (imagePath: string | undefined) => {
    if (!imagePath) return '/logo.png';
    // If it's already a full URL, return as is
    if (imagePath.startsWith('http')) return imagePath;
    
    // If it's a relative path starting with /uploads, construct full URL
    if (imagePath.startsWith('/uploads')) {
      const baseURL = process.env.NEXT_PUBLIC_API_URL || 'https://teameklavya.onrender.com';
      return `${baseURL}${imagePath}`;
    }
    
    return imagePath;
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section with Video Background */}
      <section className="relative h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-blue-50 to-indigo-100">
        {/* Video Background */}
        <div className="absolute inset-0 w-full h-full">
          <video
            autoPlay
            muted={muted}
            loop
            playsInline
            className={`w-full h-full object-cover transition-opacity duration-500 ${
              videoPlaying ? 'opacity-20' : 'opacity-0'
            }`}
            poster="/hero-poster.jpg"
          >
            <source src="/hero-video.mp4" type="video/mp4" />
            <source src="/hero-video.webm" type="video/webm" />
            <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-purple-700 flex items-center justify-center">
              <p className="text-white text-lg">Video not supported</p>
            </div>
          </video>
          
          {/* Light overlay */}
          <div className="absolute inset-0 bg-white/30 backdrop-blur-[1px]" />
        </div>

        {/* Video Controls */}
        <div className="absolute top-6 right-6 flex gap-2 z-20">
          <Button
            variant="secondary"
            size="icon"
            onClick={toggleVideo}
            className="bg-white/80 text-gray-700 hover:bg-white backdrop-blur-sm border-0 shadow-lg"
          >
            {videoPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={toggleMute}
            className="bg-white/80 text-gray-700 hover:bg-white backdrop-blur-sm border-0 shadow-lg"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
        </div>

        {/* Hero Content */}
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
          {/* Logo */}
          <div className="mb-8 animate-fade-in-up">
            <img 
              src="/logo1.png" 
              alt="Team Eklavya" 
              className="mx-auto h-32 w-auto mb-6 drop-shadow-2xl animate-float"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/api/placeholder/200/200';
              }}
            />
          </div>

          {/* Main Heading */}
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight animate-fade-in-up text-gray-900">
            Welcome to{" "}
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Team Eklavya
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-xl md:text-2xl mb-8 text-gray-700 max-w-2xl mx-auto leading-relaxed animate-fade-in-up delay-200">
            Building a thriving community of innovators, learners, and creators shaping the future together.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12 animate-fade-in-up delay-300">
            <Button 
              size="lg" 
              className="bg-blue-600 text-white hover:bg-blue-700 px-8 py-3 text-lg font-semibold rounded-full shadow-2xl transition-all duration-300 hover:scale-105 border-0"
              asChild
            >
              <Link href="/signup">
                Sign Up
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button 
              variant="outline" 
              size="lg"
              className="border-blue-600 text-blue-600 hover:bg-blue-50 px-8 py-3 text-lg font-semibold rounded-full transition-all duration-300 hover:scale-105"
              asChild
            >
              <Link href="/events">
                Explore Events
              </Link>
            </Button>
          </div>

          {/* Social Media Links */}
          <div className="flex justify-center space-x-6 animate-fade-in-up delay-400">
            {socialLinks.map((social) => (
              <a
                key={social.name}
                href={social.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`p-3 bg-white/80 rounded-full backdrop-blur-sm transition-all duration-300 hover:scale-110 shadow-lg ${social.color} text-gray-700`}
                aria-label={social.name}
              >
                <social.icon className="h-6 w-6" />
              </a>
            ))}
          </div>
        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 border-2 border-blue-600 rounded-full flex justify-center">
            <div className="w-1 h-3 bg-blue-600 rounded-full mt-2 animate-pulse" />
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { icon: Users, label: "Members", value: stats.members },
              { icon: Calendar, label: "Events", value: stats.events },
              { icon: Users, label: "Communities", value: stats.communities },
              { icon: MessageCircle, label: "Projects", value: stats.projects }
            ].map((stat, index) => (
              <div 
                key={stat.label}
                className="text-center group animate-fade-in-up"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4 group-hover:scale-110 transition-transform duration-300">
                  <stat.icon className="h-8 w-8 text-blue-600" />
                </div>
                <div className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
                  {loading ? (
                    <Skeleton className="h-8 w-16 mx-auto" />
                  ) : (
                    <>
                      {stat.value}
                      {stat.label === "Members" && "+"}
                    </>
                  )}
                </div>
                <p className="text-gray-600 font-medium">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Events Preview */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6">
          {/* Section Header */}
          <div className="text-center mb-16 animate-fade-in-up">
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Upcoming <span className="text-blue-600">Events</span>
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Join our exciting events and connect with like-minded innovators and creators.
            </p>
          </div>

          {/* Events Grid */}
          {loading ? (
            <div className="grid md:grid-cols-3 gap-8">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="overflow-hidden border-0 shadow-lg">
                  <Skeleton className="h-48 w-full" />
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4 mb-2" />
                    <Skeleton className="h-4 w-full" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-4 w-full mb-2" />
                    <Skeleton className="h-4 w-2/3" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-12 animate-fade-in-up">
              <Calendar className="h-24 w-24 text-gray-400 mx-auto mb-4" />
              <h3 className="text-2xl font-semibold text-gray-600 mb-2">
                No Upcoming Events
              </h3>
              <p className="text-gray-500 mb-6">
                Check back later for exciting events!
              </p>
              <Button asChild>
                <Link href="/events">
                  Browse All Events
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-8">
              {events.map((event, index) => (
                <Card 
                  key={event._id} 
                  className="group overflow-hidden border-0 shadow-lg hover:shadow-2xl transition-all duration-500 animate-fade-in-up bg-white"
                  style={{ animationDelay: `${index * 150}ms` }}
                >
                  <div className="relative overflow-hidden">
                    <img 
                      src={getImageUrl(event.bannerUrl)} 
                      alt={event.title}
                      className="w-full h-48 object-cover group-hover:scale-110 transition-transform duration-500"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/api/placeholder/400/200';
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  </div>
                  
                  <CardHeader className="pb-3">
                    <CardTitle className="text-xl font-bold line-clamp-2 group-hover:text-blue-600 transition-colors duration-300 text-gray-900">
                      {event.title}
                    </CardTitle>
                    <CardDescription className="line-clamp-2 text-gray-600">
                      {event.description?.substring(0, 100) || "No description available"}...
                    </CardDescription>
                  </CardHeader>
                  
                  <CardContent className="pb-4">
                    <div className="flex items-center text-sm text-gray-600 mb-2">
                      <Calendar className="h-4 w-4 mr-2 flex-shrink-0" />
                      <span>
                        {formatDate(event.startDate)}
                        {event.endDate && event.endDate !== event.startDate && ` - ${formatDate(event.endDate)}`}
                      </span>
                    </div>
                    {event.venue && (
                      <div className="flex items-center text-sm text-gray-600">
                        <MapPin className="h-4 w-4 mr-2 flex-shrink-0" />
                        <span className="truncate">{event.venue}</span>
                      </div>
                    )}
                  </CardContent>
                  
                  <CardFooter>
                    <Button className="w-full group/btn bg-blue-600 hover:bg-blue-700" asChild>
                      <Link href={`/events/${event.slug || event._id}`}>
                        View Details
                        <ArrowRight className="ml-2 h-4 w-4 group-hover/btn:translate-x-1 transition-transform duration-300" />
                      </Link>
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}

          {/* View All Events Button */}
          {events.length > 0 && (
            <div className="text-center mt-12 animate-fade-in-up">
              <Button variant="outline" size="lg" asChild className="border-blue-600 text-blue-600 hover:bg-blue-50">
                <Link href="/events" className="group">
                  View All Events
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform duration-300" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-purple-600 text-white">
        <div className="max-w-4xl mx-auto text-center px-6">
          <h2 className="text-4xl md:text-5xl font-bold mb-6 animate-fade-in-up">
            Ready to Join Our Community?
          </h2>
          <p className="text-xl mb-8 text-blue-100 animate-fade-in-up delay-200">
            Connect with innovators, attend amazing events, and be part of something extraordinary.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in-up delay-300">
            <Button 
              size="lg" 
              variant="secondary"
              className="bg-white text-blue-600 hover:bg-gray-100 px-8 py-3 text-lg font-semibold border-0"
              asChild
            >
              <Link href="/signup">
                Get Started Today
              </Link>
            </Button>
            <Button 
              size="lg"
              variant="outline" 
              className="border-white text-white hover:bg-white/10 px-8 py-3 text-lg font-semibold"
              asChild
            >
              <Link href="/about">
                Learn More
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            {/* Brand */}
            <div className="md:col-span-2">
              <img 
                src="/logo.png" 
                alt="Team Eklavya" 
                className="h-12 mb-4"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/api/placeholder/150/50';
                }}
              />
              <p className="text-gray-400 mb-4 max-w-md">
                Building a thriving community of innovators, learners, and creators shaping the future together through technology and collaboration.
              </p>
              <div className="flex space-x-4">
                {socialLinks.map((social) => (
                  <a
                    key={social.name}
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`p-2 bg-gray-800 rounded-lg transition-all duration-300 hover:scale-110 ${social.color} text-gray-300`}
                    aria-label={social.name}
                  >
                    <social.icon className="h-5 w-5" />
                  </a>
                ))}
              </div>
            </div>

            {/* Quick Links */}
            <div>
              <h3 className="font-semibold mb-4">Quick Links</h3>
              <div className="space-y-2">
                <Link href="/" className="block text-gray-400 hover:text-white transition-colors">Home</Link>
                <Link href="/events" className="block text-gray-400 hover:text-white transition-colors">Events</Link>
                <Link href="/about" className="block text-gray-400 hover:text-white transition-colors">About</Link>
                <Link href="/contact" className="block text-gray-400 hover:text-white transition-colors">Contact</Link>
              </div>
            </div>

            {/* Support */}
            <div>
              <h3 className="font-semibold mb-4">Support</h3>
              <div className="space-y-2">
                <Link href="/help" className="block text-gray-400 hover:text-white transition-colors">Help Center</Link>
                <Link href="/privacy" className="block text-gray-400 hover:text-white transition-colors">Privacy Policy</Link>
                <Link href="/terms" className="block text-gray-400 hover:text-white transition-colors">Terms of Service</Link>
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-gray-800 text-center">
            <p className="text-gray-400">
              © {new Date().getFullYear()} Team Eklavya. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}