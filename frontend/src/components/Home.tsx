"use client";

import Head from "next/head";
import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
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
  MapPin,
  Zap,
  Sparkles,
  Rocket
} from "lucide-react";




export default function Home() {
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

  const statItems = useMemo(() => [
    { icon: Users, label: "Members", value: stats.members, suffix: "+" },
    { icon: Calendar, label: "Events", value: stats.events, suffix: "+" },
    { icon: MessageCircle, label: "Projects", value: stats.projects, suffix: "+" },
    { icon: Users, label: "Communities", value: stats.communities, suffix: "" }
  ], [stats]);

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
    <>
      <Head>
        {/* Primary Meta Tags */}
        <title>Team Eklavya | Empowering Students, Enriching Futures</title>
        <meta
          name="description"
          content="Team Eklavya empowers students through technology, innovation, and collaboration. Join our workshops, hackathons, and real-world learning programs."
        />
        <meta
          name="keywords"
          content="Team Eklavya, student community, innovation, hackathons, workshops, technology, AR VR, education, student empowerment"
        />
        <meta name="author" content="Team Eklavya" />
        <meta name="robots" content="index, follow" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta httpEquiv="Content-Type" content="text/html; charset=utf-8" />
        <meta name="language" content="English" />
        <meta name="theme-color" content="#2563eb" />

        {/* Open Graph / Facebook */}
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://iteameklavya.vercel.app/" />
        <meta
          property="og:title"
          content="Team Eklavya | Empowering Students, Enriching Futures"
        />
        <meta
          property="og:description"
          content="Join Team Eklavya — a community of learners, innovators, and leaders empowering the next generation through technology and collaboration."
        />
        <meta
          property="og:image"
          content="https://iteameklavya.vercel.app/og-image.png"
        />
        <meta property="og:site_name" content="Team Eklavya" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:creator" content="@iteameklavya" />
        <meta
          name="twitter:title"
          content="Team Eklavya | Empowering Students, Enriching Futures"
        />
        <meta
          name="twitter:description"
          content="Team Eklavya connects students and innovators through workshops, hackathons, and mentorship programs."
        />
        <meta
          name="twitter:image"
          content="https://iteameklavya.vercel.app/og-image.png"
        />

        {/* Canonical URL */}
        <link rel="canonical" href="https://iteameklavya.vercel.app/" />

        {/* Favicon */}
        <link rel="icon" href="/favicon.ico" />

        {/* Structured Data (JSON-LD) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Team Eklavya",
              url: "https://iteameklavya.vercel.app/",
              logo: "https://iteameklavya.vercel.app/logo.png",
              sameAs: [
                "https://www.instagram.com/iteameklavya",
                "https://x.com/iteameklavya",
                "https://www.linkedin.com/company/i-team-eklavya"
              ],
              description:
                "Team Eklavya is a student-driven initiative fostering innovation, collaboration, and technical excellence across India.",
            }),
          }}
        />
      </Head>

      <div className="min-h-screen bg-white">
        {/* Hero Section with New Design */}
        <section className="relative py-20 md:py-32 overflow-hidden">
          {/* Background Animation */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-purple-50" />
          <div className="absolute inset-0 opacity-30">
            <div className="absolute top-20 left-10 w-48 h-48 sm:w-72 sm:h-72 bg-blue-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob" />
            <div className="absolute top-40 right-10 w-48 h-48 sm:w-72 sm:h-72 bg-purple-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000" />
            <div className="absolute bottom-20 left-1/2 w-48 h-48 sm:w-72 sm:h-72 bg-pink-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000" />
          </div>

          {/* Video Background */}
          <div className="absolute inset-0 w-full h-full">
            <video
              autoPlay
              muted={muted}
              loop
              playsInline
              className={`w-full h-full object-cover transition-opacity duration-500 ${videoPlaying ? 'opacity-10' : 'opacity-0'
                }`}
              poster="/hero-poster.jpg"
            >
              <source src="/hero-video.mp4" type="video/mp4" />
              <source src="/hero-video.webm" type="video/webm" />
            </video>
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

          <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
            <div className="text-center max-w-4xl mx-auto">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm text-blue-600 px-4 py-2 sm:px-6 sm:py-3 rounded-full mb-6 sm:mb-8 font-medium shadow-lg border border-blue-100"
              >
                <Zap className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="text-sm sm:text-base">Building the Future Together</span>
              </motion.div>

              {/* Logo */}
              <div className="mb-8">
                <motion.img
                  src="/logo1.png"
                  alt="Team Eklavya"
                  className="mx-auto h-32 w-auto mb-6 drop-shadow-2xl"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.1 }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/api/placeholder/200/200';
                  }}
                />
              </div>

              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 sm:mb-8 leading-tight text-gray-900"
              >
                Welcome to{" "}
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                  Team Eklavya
                </span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="text-lg sm:text-xl md:text-2xl text-gray-600 mb-8 sm:mb-12 leading-relaxed"
              >
                Building a thriving community of innovators, learners, and creators shaping the future together.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center mb-8"
              >
                <Button
                  size="lg"
                  className="group relative bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:bg-gradient-to-r hover:from-purple-600 hover:to-pink-600 px-8 py-3 text-lg font-semibold rounded-full overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105 border-0"
                  asChild
                >
                  <Link href="/signup">
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      Sign Up
                      <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </Link>
                </Button>

                <Button
                  variant="outline"
                  size="lg"
                  className="border-2 border-gray-300 text-gray-700 hover:border-blue-600 hover:text-blue-600 px-8 py-3 text-lg font-semibold rounded-full transition-all duration-300 hover:scale-105 bg-white/80 backdrop-blur-sm"
                  asChild
                >
                  <Link href="/events">
                    Explore Events
                  </Link>
                </Button>
              </motion.div>

              {/* Social Media Links */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
                className="flex justify-center space-x-6"
              >
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
              </motion.div>
            </div>
          </div>

          {/* Scroll Indicator */}
          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce">
            <div className="w-6 h-10 border-2 border-blue-600 rounded-full flex justify-center">
              <div className="w-1 h-3 bg-blue-600 rounded-full mt-2 animate-pulse" />
            </div>
          </div>
        </section>

        {/* Stats Section with New Design */}
        <section className="py-20 bg-white relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
              {statItems.map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="text-center group"
                >
                  <div className="relative inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 mb-4 sm:mb-6">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-500 rounded-2xl opacity-10 group-hover:opacity-20 transition-opacity duration-300" />
                    <stat.icon className="relative h-8 w-8 sm:h-10 sm:w-10 text-blue-600 group-hover:scale-110 transition-transform duration-300" />
                  </div>
                  <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 mb-2">
                    {loading ? (
                      <Skeleton className="h-8 w-16 mx-auto" />
                    ) : (
                      <>
                        {stat.value}{stat.suffix}
                      </>
                    )}
                  </div>
                  <p className="text-gray-600 font-medium text-sm sm:text-lg">{stat.label}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Events Preview with New Design */}
        <section className="py-20 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            {/* Section Header */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-full mb-6 font-medium">
                <Calendar className="h-4 w-4" />
                <span>Upcoming Events</span>
              </div>
              <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 mb-6">
                Upcoming <span className="text-blue-600">Events</span>
              </h2>
              <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                Join our exciting events and connect with like-minded innovators and creators.
              </p>
            </motion.div>

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
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="text-center py-12"
              >
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
              </motion.div>
            ) : (
              <div className="grid md:grid-cols-3 gap-8">
                {events.map((event, index) => (
                  <motion.div
                    key={event._id}
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                  >
                    <Card className="group overflow-hidden border-0 shadow-lg hover:shadow-2xl transition-all duration-500 bg-white h-full">
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
                  </motion.div>
                ))}
              </div>
            )}

            {/* View All Events Button */}
            {events.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="text-center mt-12"
              >
              </motion.div>
            )}
          </div>
        </section>

        {/* CTA Section with New Design */}
        <section className="relative py-20 md:py-32 overflow-hidden">
          {/* Optimized Background */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600" />
          <div className="absolute inset-0">
            <div className="absolute top-0 left-0 w-64 h-64 md:w-96 md:h-96 bg-white/10 rounded-full blur-3xl animate-blob" />
            <div className="absolute bottom-0 right-0 w-64 h-64 md:w-96 md:h-96 bg-white/10 rounded-full blur-3xl animate-blob animation-delay-2000" />
          </div>

          <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm text-white px-4 py-2 rounded-full mb-6 md:mb-8 font-medium">
                <Rocket className="h-4 w-4" />
                <span>Join Us Today</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-6 text-white">
                Ready to Join Our Community?
              </h2>
              <p className="text-lg md:text-xl mb-8 md:mb-12 text-white/90 leading-relaxed">
                Connect with innovators, attend amazing events, and be part of something extraordinary.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 md:gap-6 justify-center">
                <Button
                  size="lg"
                  className="group px-6 py-3 md:px-8 md:py-4 bg-white text-blue-600 font-semibold rounded-full hover:bg-gray-100 transition-all duration-300 hover:scale-105 shadow-2xl text-sm md:text-base"
                  asChild
                >
                  <Link href="/signup">
                    <span className="flex items-center justify-center gap-2">
                      Get Started Today
                      <ArrowRight className="h-4 w-4 md:h-5 md:w-5 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="px-6 py-3 md:px-8 md:py-4 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-full border-2 border-white/30 hover:bg-white/20 transition-all duration-300 hover:scale-105 text-sm md:text-base"
                  asChild
                >
                  <Link href="/about">
                    Learn More
                  </Link>
                </Button>
              </div>
            </motion.div>
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

        <style jsx>{`
        @keyframes blob {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          25% {
            transform: translate(20px, -50px) scale(1.1);
          }
          50% {
            transform: translate(-20px, 20px) scale(0.9);
          }
          75% {
            transform: translate(50px, 50px) scale(1.05);
          }
        }

        .animate-blob {
          animation: blob 7s infinite;
        }

        .animation-delay-2000 {
          animation-delay: 2s;
        }

        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
      </div>
    </>
  );
}