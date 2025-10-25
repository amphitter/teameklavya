"use client";

import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { api } from "@/utils/api";
import { getImageUrl } from "@/utils/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { 
  Calendar, 
  MapPin, 
  ArrowRight, 
  Search, 
  Filter, 
  Clock, 
  Users,
  Sparkles,
  Zap,
  Tag
} from "lucide-react";

interface Event {
  _id: string;
  title: string;
  slug: string;
  bannerUrl?: string;
  startDate: string;
  endDate: string;
  venue?: string;
  description?: string;
  category?: string;
  price?: number;
  capacity?: number;
  registeredCount?: number;
}

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setLoading(true);
        const res = await api.get("/events");
        if (res.data?.success) {
          const eventsData = res.data.events || [];
          setEvents(eventsData);
          setFilteredEvents(eventsData);
        }
      } catch (err) {
        console.error("Fetch events error:", err);
        setEvents([]);
        setFilteredEvents([]);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, []);

  useEffect(() => {
    let results = events;
    
    // Filter by search term
    if (searchTerm) {
      results = results.filter(event =>
        event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        event.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        event.venue?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Filter by category
    if (selectedCategory !== "all") {
      results = results.filter(event => event.category === selectedCategory);
    }
    
    setFilteredEvents(results);
  }, [searchTerm, selectedCategory, events]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getCategories = () => {
    const categories = events.map(event => event.category).filter(Boolean) as string[];
    return [...new Set(categories)];
  };

  const isEventLive = (startDate: string, endDate: string) => {
    const now = new Date();
    const start = new Date(startDate);
    const end = new Date(endDate);
    return now >= start && now <= end;
  };

  const isEventUpcoming = (startDate: string) => {
    return new Date(startDate) > new Date();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header Skeleton */}
          <div className="text-center mb-12">
            <Skeleton className="h-12 w-64 mx-auto mb-4" />
            <Skeleton className="h-6 w-96 mx-auto" />
          </div>

          {/* Filters Skeleton */}
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <Skeleton className="h-12 flex-1" />
            <Skeleton className="h-12 w-32" />
          </div>

          {/* Events Grid Skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {Array.from({ length: 6 }).map((_, idx) => (
              <Card key={idx} className="overflow-hidden border-0 shadow-lg">
                <Skeleton className="h-48 w-full" />
                <CardHeader className="pb-3">
                  <Skeleton className="h-6 w-3/4 mb-2" />
                  <Skeleton className="h-4 w-full" />
                </CardHeader>
                <CardContent className="pb-4">
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
                <CardFooter>
                  <Skeleton className="h-10 w-full" />
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header Section */}
      <section className="relative py-16 md:py-24 bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-20 left-10 w-48 h-48 sm:w-72 sm:h-72 bg-blue-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob" />
          <div className="absolute top-40 right-10 w-48 h-48 sm:w-72 sm:h-72 bg-purple-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000" />
          <div className="absolute bottom-20 left-1/2 w-48 h-48 sm:w-72 sm:h-72 bg-pink-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm text-blue-600 px-4 py-2 rounded-full mb-6 font-medium shadow-lg border border-blue-100">
              <Sparkles className="h-4 w-4" />
              <span>Discover Events</span>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 mb-6">
              Explore <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Events</span>
            </h1>
            <p className="text-lg sm:text-xl md:text-2xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Join our exciting lineup of events, workshops, and gatherings. 
              Connect, learn, and grow with our vibrant community.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Search and Filters Section */}
      <section className="py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="flex flex-col sm:flex-row gap-4 mb-8"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                type="text"
                placeholder="Search events by title, description, or venue..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-12 border-gray-300 focus:border-blue-500 bg-white rounded-xl text-black shadow-sm"
              />
            </div>
            
            <div className="flex gap-2">
              <div className="relative">
                <Tag className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="h-12 pl-10 pr-8 border border-gray-300 rounded-xl focus:border-blue-500  text-black focus:ring-1 focus:ring-blue-500 bg-white shadow-sm appearance-none"
                >
                  <option value="all">All Categories</option>
                  {getCategories().map(category => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              
              <Button
                variant="outline"
                onClick={() => {
                  setSearchTerm("");
                  setSelectedCategory("all");
                }}
                className="h-12 border-gray-300 text-white hover:bg-gray-700 rounded-xl shadow-sm"
              >
                <Filter className="h-4 w-4 mr-2" />
                Reset
              </Button>
            </div>
          </motion.div>

          {/* Results Count */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mb-6"
          >
            <p className="text-gray-600 font-medium">
              Showing {filteredEvents.length} of {events.length} events
              {searchTerm && ` for "${searchTerm}"`}
              {selectedCategory !== "all" && ` in ${selectedCategory}`}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Events Grid Section */}
      <section className="py-12 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {filteredEvents.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center py-16"
            >
              <div className="bg-white rounded-2xl p-12 border-0 shadow-lg max-w-md mx-auto">
                <Calendar className="h-24 w-24 text-gray-400 mx-auto mb-6" />
                <h3 className="text-2xl font-semibold text-gray-900 mb-3">
                  No Events Found
                </h3>
                <p className="text-gray-600 mb-6">
                  {searchTerm || selectedCategory !== "all" 
                    ? "Try adjusting your search terms or filters to find more events."
                    : "Check back soon for upcoming events!"}
                </p>
                {(searchTerm || selectedCategory !== "all") && (
                  <Button
                    onClick={() => {
                      setSearchTerm("");
                      setSelectedCategory("all");
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
                  >
                    View All Events
                  </Button>
                )}
              </div>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredEvents.map((event, index) => (
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
                          (e.target as HTMLImageElement).src = '/logo.png';
                        }}
                      />
                      
                      {/* Event Status Badge */}
                      <div className="absolute top-4 left-4">
                        {isEventLive(event.startDate, event.endDate) && (
                          <span className="bg-red-500 text-white px-3 py-1 rounded-full text-xs font-semibold shadow-lg">
                            🔴 Live Now
                          </span>
                        )}
                        {isEventUpcoming(event.startDate) && !isEventLive(event.startDate, event.endDate) && (
                          <span className="bg-green-500 text-white px-3 py-1 rounded-full text-xs font-semibold shadow-lg">
                            ⏰ Upcoming
                          </span>
                        )}
                      </div>
                      
                      {/* Category Badge */}
                      {event.category && (
                        <div className="absolute top-4 right-4">
                          <span className="bg-gray-800/90 text-white px-3 py-1 rounded-full text-xs font-medium shadow-lg backdrop-blur-sm">
                            {event.category}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    <CardHeader className="pb-3">
                      <CardTitle className="text-xl font-bold line-clamp-2 group-hover:text-blue-600 transition-colors duration-300 text-gray-900">
                        {event.title}
                      </CardTitle>
                      <CardDescription className="line-clamp-2 text-gray-600">
                        {event.description || "Join us for an amazing event!"}
                      </CardDescription>
                    </CardHeader>
                    
                    <CardContent className="pb-4 space-y-3">
                      {/* Date and Time */}
                      <div className="flex items-center text-sm text-gray-600">
                        <Calendar className="h-4 w-4 mr-2 flex-shrink-0" />
                        <div>
                          <span>{formatDate(event.startDate)}</span>
                          {event.endDate && event.endDate !== event.startDate && (
                            <span> - {formatDate(event.endDate)}</span>
                          )}
                        </div>
                      </div>
                      
                      {/* Time */}
                      <div className="flex items-center text-sm text-gray-600">
                        <Clock className="h-4 w-4 mr-2 flex-shrink-0" />
                        <span>{formatTime(event.startDate)}</span>
                      </div>
                      
                      {/* Venue */}
                      {event.venue && (
                        <div className="flex items-center text-sm text-gray-600">
                          <MapPin className="h-4 w-4 mr-2 flex-shrink-0" />
                          <span className="truncate">{event.venue}</span>
                        </div>
                      )}
                      
                      {/* Capacity */}
                      {(event.capacity || event.registeredCount) && (
                        <div className="flex items-center text-sm text-gray-600">
                          <Users className="h-4 w-4 mr-2 flex-shrink-0" />
                          <span>
                            {event.registeredCount || 0}
                            {event.capacity && ` / ${event.capacity} registered`}
                          </span>
                        </div>
                      )}
                      
                      {/* Price */}
                      {event.price !== undefined && event.price > 0 && (
                        <div className="text-sm font-semibold text-green-600">
                          ${event.price.toFixed(2)}
                        </div>
                      )}
                      {event.price === 0 && (
                        <div className="text-sm font-semibold text-green-600">
                          Free
                        </div>
                      )}
                    </CardContent>
                    
                    <CardFooter>
                      <Button 
                        className="w-full group/btn bg-gradient-to-r from-blue-600 to-purple-600 hover:from-purple-600 hover:to-pink-600 text-white rounded-xl shadow-lg hover:shadow-xl transition-all duration-300" 
                        asChild
                      >
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

          {/* Back to Home */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mt-12"
          >
          </motion.div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-20 md:py-32 overflow-hidden">
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
              <Zap className="h-4 w-4" />
              <span>Can't Find What You're Looking For?</span>
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-6 text-white">
              Suggest an Event
            </h2>
            <p className="text-lg md:text-xl mb-8 md:mb-12 text-white/90 leading-relaxed">
              Have an idea for an event? We'd love to hear from you and make it happen!
            </p>
            <div className="flex flex-col sm:flex-row gap-4 md:gap-6 justify-center">
              <Button 
                size="lg"
                className="group px-6 py-3 md:px-8 md:py-4 bg-white text-blue-600 font-semibold rounded-full hover:bg-gray-100 transition-all duration-300 hover:scale-105 shadow-2xl text-sm md:text-base"
                asChild
              >
                <Link href="/contact">
                  <span className="flex items-center justify-center gap-2">
                    Contact Us
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
                <Link href="/">
                  Back to Home
                </Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

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
  );
}