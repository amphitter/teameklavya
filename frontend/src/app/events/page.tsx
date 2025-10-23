"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/utils/api";
import { getImageUrl } from "@/utils/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, MapPin, ArrowRight, Search, Filter, Clock, Users } from "lucide-react";
import { Input } from "@/components/ui/input";

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
              <Card key={idx} className="overflow-hidden border border-gray-200 shadow-sm">
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
    <div className="min-h-screen bg-white py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12 animate-fade-in-up">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Discover <span className="text-blue-600">Events</span>
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Explore our exciting lineup of events, workshops, and gatherings. 
            Connect, learn, and grow with our community.
          </p>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8 animate-fade-in-up delay-100">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              type="text"
              placeholder="Search events by title, description, or venue..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 h-12 border-gray-300 focus:border-blue-500 bg-white"
            />
          </div>
          
          <div className="flex gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-12 px-4 border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
            >
              <option value="all">All Categories</option>
              {getCategories().map(category => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            
            <Button
              variant="outline"
              onClick={() => {
                setSearchTerm("");
                setSelectedCategory("all");
              }}
              className="h-12 border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <Filter className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>
        </div>

        {/* Results Count */}
        <div className="mb-6 animate-fade-in-up delay-200">
          <p className="text-gray-600">
            Showing {filteredEvents.length} of {events.length} events
            {searchTerm && ` for "${searchTerm}"`}
            {selectedCategory !== "all" && ` in ${selectedCategory}`}
          </p>
        </div>

        {/* Events Grid */}
        {filteredEvents.length === 0 ? (
          <div className="text-center py-16 animate-fade-in-up">
            <div className="bg-white rounded-2xl p-12 border border-gray-200 shadow-sm max-w-md mx-auto">
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
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  View All Events
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredEvents.map((event, index) => (
              <Card 
                key={event._id} 
                className="group overflow-hidden border border-gray-200 shadow-sm hover:shadow-lg transition-all duration-500 animate-fade-in-up bg-white"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="relative overflow-hidden">
                  <img 
                    src={getImageUrl(event.bannerUrl)} 
                    alt={event.title}
                    className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-500"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/logo.png';
                    }}
                  />
                  
                  {/* Event Status Badge */}
                  <div className="absolute top-4 left-4">
                    {isEventLive(event.startDate, event.endDate) && (
                      <span className="bg-red-500 text-white px-3 py-1 rounded-full text-xs font-semibold">
                        Live Now
                      </span>
                    )}
                    {isEventUpcoming(event.startDate) && !isEventLive(event.startDate, event.endDate) && (
                      <span className="bg-green-500 text-white px-3 py-1 rounded-full text-xs font-semibold">
                        Upcoming
                      </span>
                    )}
                  </div>
                  
                  {/* Category Badge */}
                  {event.category && (
                    <div className="absolute top-4 right-4">
                      <span className="bg-gray-800 text-white px-3 py-1 rounded-full text-xs font-medium">
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
                  <Button className="w-full group/btn bg-blue-600 hover:bg-blue-700 text-white" asChild>
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

        {/* Empty State when no events at all */}
      </div>
    </div>
  );
}