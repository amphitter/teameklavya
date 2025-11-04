"use client";

import Head from "next/head";
import { useEffect, useState, useMemo, useRef } from "react";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { api } from "@/utils/api";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/context/ThemeContext";
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
  Rocket,
  Sun,
  Moon,
  Star,
  Target,
  Heart,
  Code,
  Palette,
  Camera,
  TrendingUp,
  Globe,
  Shield,
  Users2,
  Lightbulb,
  Award,
  ChevronLeft,
  ChevronRight,
  ExternalLink
} from "lucide-react";
import NewsletterEvents from "./NewsLetter";

const ThreeScene = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const setCanvasSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    setCanvasSize();
    window.addEventListener('resize', setCanvasSize);

    const particles: Array<{
      x: number;
      y: number;
      size: number;
      speedX: number;
      speedY: number;
      color: string;
    }> = [];

    const particleCount = 60;
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 2 + 0.8,
        speedX: (Math.random() - 0.5) * 0.4,
        speedY: (Math.random() - 0.5) * 0.4,
        color: theme === 'dark'
          ? `rgba(100, 200, 255, ${Math.random() * 0.25 + 0.05})`
          : `rgba(59, 130, 246, ${Math.random() * 0.18 + 0.04})`
      });
    }

    let rafId = 0;
    const animate = () => {
      if (!ctx) return;

      // semi-transparent clearing to create motion trails
      ctx.fillStyle = theme === 'dark' ? 'rgba(10,12,20,0.08)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      particles.forEach((particle) => {
        particle.x += particle.speedX;
        particle.y += particle.speedY;

        if (particle.x < 0) particle.x = canvas.width;
        if (particle.x > canvas.width) particle.x = 0;
        if (particle.y < 0) particle.y = canvas.height;
        if (particle.y > canvas.height) particle.y = 0;

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = particle.color;
        ctx.fill();

        // connections
        particles.forEach((other) => {
          const dx = particle.x - other.x;
          const dy = particle.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            ctx.beginPath();
            ctx.strokeStyle = theme === 'dark'
              ? `rgba(100,200,255,${0.15 * (1 - dist / 110)})`
              : `rgba(59,130,246,${0.08 * (1 - dist / 110)})`;
            ctx.lineWidth = 0.4;
            ctx.moveTo(particle.x, particle.y);
            ctx.lineTo(other.x, other.y);
            ctx.stroke();
          }
        });
      });

      rafId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', setCanvasSize);
      cancelAnimationFrame(rafId);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none opacity-30 z-0"
    />
  );
};

// Floating elements component for additional visual interest
const FloatingElements = () => {
  const { theme } = useTheme();
  
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {/* Floating shapes */}
      <motion.div
        className={`absolute top-1/4 left-1/4 w-6 h-6 rounded-full ${
          theme === 'dark' ? 'bg-blue-400/20' : 'bg-blue-600/20'
        }`}
        animate={{
          y: [0, -30, 0],
          x: [0, 15, 0],
          scale: [1, 1.2, 1],
        }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.div
        className={`absolute top-1/3 right-1/4 w-4 h-4 rounded-full ${
          theme === 'dark' ? 'bg-purple-400/20' : 'bg-purple-600/20'
        }`}
        animate={{
          y: [0, 20, 0],
          x: [0, -10, 0],
          scale: [1, 1.5, 1],
        }}
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1
        }}
      />
      <motion.div
        className={`absolute bottom-1/4 left-1/3 w-8 h-8 rounded-full ${
          theme === 'dark' ? 'bg-pink-400/15' : 'bg-pink-600/15'
        }`}
        animate={{
          y: [0, 25, 0],
          x: [0, -20, 0],
          scale: [1, 0.8, 1],
        }}
        transition={{
          duration: 7,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 2
        }}
      />
    </div>
  );
};

export default function Home() {
  const [memberCount, setMemberCount] = useState(0);
  const [events, setEvents] = useState<any[]>([]);
  const [pastEvents, setPastEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [videoPlaying, setVideoPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [currentPastEventIndex, setCurrentPastEventIndex] = useState(0);
  const [stats, setStats] = useState({
    members: 900,
    events: 0,
    communities: 12,
    projects: 45
  });
  const [isVisible, setIsVisible] = useState(false);

  const { theme, toggleTheme } = useTheme();
  const { scrollYProgress } = useScroll();
  const opacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.2], [1, 0.95]);

  const logoUrl = theme === 'dark' ? '/logo.png' : '/logo1.png';

  const socialLinks = [
    {
      name: "Instagram",
      url: "https://www.instagram.com/iteameklavya",
      icon: Instagram,
      color: "hover:text-pink-600 dark:hover:text-pink-400"
    },
    {
      name: "Twitter",
      url: "https://x.com/iteameklavya",
      icon: Twitter,
      color: "hover:text-blue-400 dark:hover:text-blue-300"
    },
    {
      name: "LinkedIn",
      url: "https://www.linkedin.com/company/i-team-eklavya",
      icon: Linkedin,
      color: "hover:text-blue-600 dark:hover:text-blue-400"
    },
    {
      name: "WhatsApp",
      url: "https://chat.whatsapp.com/L7HvHNOatFbHIWM7EGBaaA",
      icon: MessageCircle,
      color: "hover:text-green-500 dark:hover:text-green-400"
    }
  ];

  const statItems = useMemo(() => [
    { icon: Users, label: "Members", value: stats.members, suffix: "+" },
    { icon: Calendar, label: "Events", value: stats.events, suffix: "+" },
    { icon: MessageCircle, label: "Projects", value: stats.projects, suffix: "+" },
    { icon: Users, label: "Communities", value: stats.communities, suffix: "" }
  ], [stats]);

  const features = [
    {
      icon: Lightbulb,
      title: "Innovation Hub",
      description: "Collaborate on cutting-edge projects and bring your ideas to life with like-minded innovators.",
      color: "text-yellow-500"
    },
    {
      icon: Users2,
      title: "Community First",
      description: "Join a vibrant community of learners, creators, and tech enthusiasts who support each other.",
      color: "text-blue-500"
    },
    {
      icon: Target,
      title: "Skill Development",
      description: "Enhance your skills through workshops, hackathons, and real-world project experiences.",
      color: "text-green-500"
    },
    {
      icon: Globe,
      title: "Global Network",
      description: "Connect with professionals and students from various backgrounds and institutions.",
      color: "text-purple-500"
    },
    {
      icon: Award,
      title: "Recognition",
      description: "Get recognized for your contributions and build an impressive portfolio of work.",
      color: "text-red-500"
    },
    {
      icon: Rocket,
      title: "Career Growth",
      description: "Access mentorship and opportunities that accelerate your professional development.",
      color: "text-pink-500"
    }
  ];

  // Fixed Animation variants with proper TypeScript types
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.6,
        ease: "easeOut" as const
      }
    }
  };

  const cardVariants = {
    hidden: { opacity: 0, y: 30, scale: 0.95 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: 0.5,
        ease: "easeOut" as const
      }
    },
    hover: {
      y: -8,
      scale: 1.02,
      transition: {
        duration: 0.3,
        ease: "easeInOut" as const
      }
    }
  };

  const statCardVariants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: 0.5,
        ease: "easeOut" as const
      }
    },
    hover: {
      scale: 1.05,
      transition: {
        duration: 0.2,
        ease: "easeInOut" as const
      }
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const eventsRes = await api.get("/events?limit=50");
        const eventsData = eventsRes.data.events || [];

        const now = new Date();
        const upcoming = eventsData
          .filter((event: any) => new Date(event.endDate) >= now)
          .sort((a: any, b: any) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

        const past = eventsData
          .filter((event: any) => new Date(event.endDate) < now)
          .sort((a: any, b: any) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

        setEvents(upcoming.slice(0, 3));
        setPastEvents(past.slice(0, 6));
        setStats(prev => ({ ...prev, events: eventsData.length }));
        animateCounter(900, 1200, setMemberCount);
        
        // Trigger animations after data loads
        setTimeout(() => setIsVisible(true), 300);
      } catch (err) {
        console.error("Failed to fetch data:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (pastEvents.length > 0) {
      const interval = setInterval(() => {
        setCurrentPastEventIndex((prev) => (prev + 1) % pastEvents.length);
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [pastEvents.length]);

  const animateCounter = (target: number, duration: number, setter: (value: number) => void) => {
    let start = 0;
    const increment = target / (duration / 16);
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

  const toggleVideo = () => setVideoPlaying(!videoPlaying);
  const toggleMute = () => setMuted(!muted);

  const getImageUrl = (imagePath: string | undefined) => {
    if (!imagePath) return '/logo.png';
    if (imagePath.startsWith('http')) return imagePath;
    if (imagePath.startsWith('/uploads')) {
      const baseURL = process.env.NEXT_PUBLIC_API_URL || 'https://teameklavya.onrender.com';
      return `${baseURL}${imagePath}`;
    }
    return imagePath;
  };

  const nextPastEvent = () => {
    setCurrentPastEventIndex((prev) => (prev + 1) % pastEvents.length);
  };

  const prevPastEvent = () => {
    setCurrentPastEventIndex((prev) => (prev - 1 + pastEvents.length) % pastEvents.length);
  };

  return (
    <>
      <Head>
        <title>Team Eklavya - Building Future Innovators</title>
        <meta name="description" content="Join Team Eklavya - A community of innovators, learners, and creators shaping the future together through technology and collaboration." />
      </Head>

      {/* Top-level wrapper: unified dark gradient when theme is dark */}
      <motion.div 
        className={`min-h-screen transition-colors duration-300 relative overflow-hidden ${
          theme === 'dark'
            ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white'
            : 'bg-white text-gray-900'
        }`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      >

        {/* Enhanced gradient overlay */}
        {theme === 'dark' && (
          <motion.div 
            className="absolute inset-0 pointer-events-none z-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1 }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(255,255,255,0.02),transparent_40%)]" />
          </motion.div>
        )}

        {/* Enhanced Hero Section */}
        <section className="relative py-20 md:py-32 overflow-hidden min-h-screen flex items-center">
          <ThreeScene />
          <FloatingElements />

          {/* Enhanced overlay */}
          <motion.div 
            className={`absolute inset-0 transition-colors duration-300 ${
              theme === 'dark' ? 'bg-black/10' : 'bg-white/60'
            }`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1 }}
          />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10 w-full">
            <motion.div 
              className="text-center max-w-4xl mx-auto"
              initial="hidden"
              animate="visible"
              variants={containerVariants}
            >
              <motion.div className="mb-8" variants={itemVariants}>
                <motion.img
                  src={logoUrl}
                  alt="Team Eklavya"
                  className="mx-auto h-28 w-auto mb-6 drop-shadow-2xl"
                  initial={{ opacity: 0, y: 20, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ 
                    duration: 0.7, 
                    delay: 0.1,
                    type: "spring",
                    stiffness: 100
                  }}
                  whileHover={{ 
                    scale: 1.05,
                    rotateZ: 2,
                    transition: { duration: 0.3 }
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = theme === 'dark' ? '/logo.png' : '/logo1.png';
                  }}
                />
              </motion.div>

              <motion.h1
                variants={itemVariants}
                className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-6 sm:mb-8 leading-tight"
              >
                Welcome to{" "}
                <motion.span 
                  className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent"
                  animate={{
                    backgroundPosition: ["0%", "100%", "0%"],
                  }}
                  transition={{
                    duration: 5,
                    repeat: Infinity,
                    ease: "linear"
                  }}
                  style={{
                    backgroundSize: "200% 100%",
                  }}
                >
                  Team Eklavya
                </motion.span>
              </motion.h1>

              <motion.p
                variants={itemVariants}
                className={`text-base sm:text-lg md:text-xl mb-8 sm:mb-12 leading-relaxed ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}
              >
                Building a thriving community of innovators, learners, and creators shaping the future together through technology and collaboration.
              </motion.p>

              <motion.div
                variants={itemVariants}
                className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center mb-8"
              >
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Button
                    size="lg"
                    className="group relative bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-purple-600 hover:to-pink-600 px-8 py-3 text-base font-semibold rounded-full overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-300 border-0"
                    asChild
                  >
                    <Link href="/signup">
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        Join Our Community
                        <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                      </span>
                    </Link>
                  </Button>
                </motion.div>

                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Button
                    variant="outline"
                    size="lg"
                    className={`px-8 py-3 text-base font-semibold rounded-full transition-all duration-300 backdrop-blur-sm ${
                      theme === 'dark'
                        ? 'border-2 border-slate-600 text-gray-300 hover:border-blue-500 hover:text-blue-400 bg-transparent'
                        : 'border-2 border-gray-300 text-gray-700 hover:border-blue-600 hover:text-blue-600 bg-white/80'
                    }`}
                    asChild
                  >
                    <Link href="/events">
                      Explore Events
                    </Link>
                  </Button>
                </motion.div>
              </motion.div>

              <motion.div
                variants={itemVariants}
                className="flex justify-center space-x-4"
              >
                {socialLinks.map((social, index) => (
                  <motion.a
                    key={social.name}
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`p-3 rounded-full backdrop-blur-sm transition-all duration-300 shadow-lg ${
                      theme === 'dark'
                        ? 'bg-slate-800/70 text-gray-300 hover:bg-slate-700'
                        : 'bg-white/80 text-gray-700'
                    } ${social.color}`}
                    aria-label={social.name}
                    whileHover={{ 
                      scale: 1.15,
                      y: -2,
                    }}
                    whileTap={{ scale: 0.9 }}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ 
                      opacity: 1, 
                      y: 0,
                      transition: { delay: 0.5 + index * 0.1 }
                    }}
                  >
                    <social.icon className="h-5 w-5" />
                  </motion.a>
                ))}
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Enhanced Stats Section */}
        <motion.section 
          className={`py-16 relative transition-colors duration-300 ${
            theme === 'dark' ? 'bg-transparent' : 'bg-white'
          }`}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8 }}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <motion.div 
              className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={containerVariants}
            >
              {statItems.map((stat, index) => (
                <motion.div
                  key={stat.label}
                  variants={statCardVariants}
                  whileHover="hover"
                  className="text-center group"
                >
                  <motion.div 
                    className="relative inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 mb-3 sm:mb-4"
                    whileHover={{ rotate: 360 }}
                    transition={{ duration: 0.6, ease: "easeInOut" }}
                  >
                    <motion.div 
                      className={`absolute inset-0 rounded-2xl opacity-10 group-hover:opacity-20 transition-opacity duration-300 ${
                        theme === 'dark'
                          ? 'bg-gradient-to-br from-blue-400 to-purple-400'
                          : 'bg-gradient-to-br from-blue-500 to-purple-500'
                      }`}
                      animate={{
                        scale: [1, 1.1, 1],
                        opacity: [0.1, 0.2, 0.1],
                      }}
                      transition={{
                        duration: 3,
                        repeat: Infinity,
                        delay: index * 0.5
                      }}
                    />
                    <stat.icon className={`relative h-6 w-6 sm:h-7 sm:w-7 transition-transform duration-300 group-hover:scale-110 ${
                      theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
                    }`} />
                  </motion.div>
                  <motion.div 
                    className={`text-2xl sm:text-3xl md:text-4xl font-bold mb-1 ${
                      theme === 'dark' ? 'text-white' : 'text-gray-900'
                    }`}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ 
                      type: "spring", 
                      stiffness: 200, 
                      delay: 0.5 + index * 0.1 
                    }}
                  >
                    {loading ? (
                      <Skeleton className={`h-7 w-16 mx-auto ${
                        theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200'
                      }`} />
                    ) : (
                      <>
                        {stat.value}{stat.suffix}
                      </>
                    )}
                  </motion.div>
                  <p className={`font-medium text-xs sm:text-sm ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                  }`}>
                    {stat.label}
                  </p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </motion.section>

        {/* Enhanced Upcoming Events Section */}
        {events.length > 0 && (
          <motion.section 
            className={`py-20 transition-colors duration-300 ${
              theme === 'dark' ? 'bg-transparent' : 'bg-white'
            }`}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="text-center mb-16"
              >
                <motion.div 
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 font-medium transition-colors duration-300 ${
                    theme === 'dark'
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/10'
                      : 'bg-blue-50 text-blue-600'
                  }`}
                  whileHover={{ scale: 1.05 }}
                >
                  <Calendar className="h-4 w-4" />
                  <span>Upcoming Events</span>
                </motion.div>
                <h2 className={`text-3xl sm:text-4xl md:text-5xl font-bold mb-6 ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  Upcoming <span className="text-blue-400">Events</span>
                </h2>
                <p className={`text-base sm:text-lg max-w-2xl mx-auto leading-relaxed ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  Join our exciting events and connect with like-minded innovators and creators.
                </p>
              </motion.div>

              <motion.div 
                className="grid md:grid-cols-3 gap-8"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={containerVariants}
              >
                {events.map((event, index) => (
                  <motion.div
                    key={event._id}
                    variants={cardVariants}
                    whileHover="hover"
                  >
                    <Card className={`group overflow-hidden border-0 shadow-lg hover:shadow-2xl transition-all duration-500 h-full ${
                      theme === 'dark'
                        ? 'bg-slate-800/30 backdrop-blur-sm'
                        : 'bg-white hover:bg-gray-50'
                    }`}>
                      <motion.div 
                        className="relative overflow-hidden"
                        whileHover={{ scale: 1.05 }}
                        transition={{ duration: 0.3 }}
                      >
                        <img
                          src={getImageUrl(event.bannerUrl)}
                          alt={event.title}
                          className="w-full h-48 object-cover group-hover:scale-110 transition-transform duration-500"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = '/api/placeholder/400/200';
                          }}
                        />
                        <motion.div 
                          className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                          whileHover={{ opacity: 1 }}
                        />
                      </motion.div>

                      <CardHeader className="pb-3">
                        <CardTitle className={`text-lg font-bold line-clamp-2 group-hover:text-blue-400 transition-colors duration-300 ${
                          theme === 'dark' ? 'text-white' : 'text-gray-900'
                        }`}>
                          {event.title}
                        </CardTitle>
                        <CardDescription className={`line-clamp-2 text-sm ${
                          theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                        }`}>
                          {event.description?.substring(0, 100) || "No description available"}...
                        </CardDescription>
                      </CardHeader>

                      <CardContent className="pb-4">
                        <div className={`flex items-center text-xs mb-2 ${
                          theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          <Calendar className="h-3 w-3 mr-2 flex-shrink-0" />
                          <span>
                            {formatDate(event.startDate)}
                            {event.endDate && event.endDate !== event.startDate && ` - ${formatDate(event.endDate)}`}
                          </span>
                        </div>
                        {event.venue && (
                          <div className={`flex items-center text-xs ${
                            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                          }`}>
                            <MapPin className="h-3 w-3 mr-2 flex-shrink-0" />
                            <span className="truncate">{event.venue}</span>
                          </div>
                        )}
                      </CardContent>

                      <CardFooter>
                        <motion.div
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className="w-full"
                        >
                          <Button className="w-full group/btn bg-blue-600 hover:bg-blue-700 text-sm" asChild>
                            <Link href={`/events/${event.slug || event._id}`}>
                              View Details
                              <ArrowRight className="ml-2 h-3 w-3 group-hover/btn:translate-x-1 transition-transform duration-300" />
                            </Link>
                          </Button>
                        </motion.div>
                      </CardFooter>
                    </Card>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </motion.section>
        )}

        {/* Enhanced Why Team Eklavya Section */}
        <motion.section 
          className={`py-20 transition-colors duration-300 ${
            theme === 'dark' ? 'bg-transparent' : 'bg-gray-50'
          }`}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <motion.div 
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 font-medium transition-colors duration-300 ${
                  theme === 'dark'
                    ? 'bg-blue-500/10 text-blue-400'
                    : 'bg-blue-50 text-blue-600'
                }`}
                whileHover={{ scale: 1.05 }}
              >
                <Target className="h-4 w-4" />
                <span>Why Choose Us</span>
              </motion.div>
              <h2 className={`text-3xl sm:text-4xl md:text-5xl font-bold mb-6 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>
                Why <span className="text-blue-600">Team Eklavya</span>?
              </h2>
              <p className={`text-base sm:text-lg max-w-2xl mx-auto leading-relaxed ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
              }`}>
                We provide a platform for students to learn, grow, and innovate together in a supportive community environment.
              </p>
            </motion.div>

            <motion.div 
              className="grid md:grid-cols-2 lg:grid-cols-3 gap-8"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={containerVariants}
            >
              {features.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  variants={cardVariants}
                  whileHover="hover"
                  className={`p-6 rounded-2xl transition-all duration-300 ${
                    theme === 'dark'
                      ? 'bg-slate-800/25 backdrop-blur-sm hover:bg-slate-800/30'
                      : 'bg-white hover:bg-gray-100'
                  } shadow-lg hover:shadow-xl`}
                >
                  <motion.div 
                    className={`w-12 h-12 rounded-lg mb-4 flex items-center justify-center ${
                      theme === 'dark' ? 'bg-slate-700' : 'bg-gray-100'
                    }`}
                    whileHover={{ 
                      rotate: 360,
                      scale: 1.1,
                      transition: { duration: 0.5 }
                    }}
                  >
                    <motion.div
                      animate={{ 
                        scale: [1, 1.2, 1],
                        rotate: [0, 5, 0, -5, 0]
                      }}
                      transition={{ 
                        duration: 4, 
                        repeat: Infinity,
                        delay: index * 0.5
                      }}
                    >
                      <feature.icon className={`h-6 w-6 ${feature.color}`} />
                    </motion.div>
                  </motion.div>
                  <h3 className={`text-lg font-semibold mb-3 ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>
                    {feature.title}
                  </h3>
                  <p className={`text-sm leading-relaxed ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                  }`}>
                    {feature.description}
                  </p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </motion.section>

        {/* NewsletterEvents */}
        <motion.div 
          className={`${theme === 'dark' ? 'bg-transparent' : ''}`}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <NewsletterEvents />
        </motion.div>

        {/* Enhanced Past Events Carousel */}
        {pastEvents.length > 0 && (
          <motion.section
            className={`py-20 transition-colors duration-500 relative overflow-hidden ${
              theme === "dark" ? "bg-transparent" : "bg-gray-50"
            }`}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <motion.div
              className={`absolute inset-0 pointer-events-none ${
                theme === "dark"
                  ? "bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.06),transparent_70%)]"
                  : "bg-[radial-gradient(circle_at_bottom_left,rgba(139,92,246,0.06),transparent_70%)]"
              }`}
              animate={{
                backgroundPosition: ["0% 0%", "100% 100%"],
              }}
              transition={{
                duration: 10,
                repeat: Infinity,
                ease: "linear"
              }}
            />

            <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="text-center mb-16 relative z-10"
              >
                <motion.div
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 font-medium shadow-sm transition-all duration-300 ${
                    theme === "dark"
                      ? "bg-purple-500/10 text-purple-300 border border-purple-400/10"
                      : "bg-purple-100 text-purple-700 border border-purple-300/60"
                  }`}
                  whileHover={{ scale: 1.05 }}
                >
                  <Award className="h-4 w-4" />
                  <span>Past Events</span>
                </motion.div>
                <h2
                  className={`text-3xl sm:text-4xl md:text-5xl font-bold mb-6 tracking-tight ${
                    theme === "dark" ? "text-white" : "text-gray-900"
                  }`}
                >
                  Our <span className="text-purple-400">Success Stories</span>
                </h2>
                <p
                  className={`text-base sm:text-lg max-w-2xl mx-auto leading-relaxed ${
                    theme === "dark" ? "text-gray-300" : "text-gray-600"
                  }`}
                >
                  Take a look at some of our most memorable events that inspired, connected,
                  and created impact within our community.
                </p>
              </motion.div>

              <div className="relative max-w-5xl mx-auto">
                <div className="relative h-80 md:h-[450px] rounded-3xl overflow-hidden shadow-2xl">
                  <AnimatePresence mode="wait">
                    {pastEvents.map((event, index) => (
                      index === currentPastEventIndex && (
                        <motion.div
                          key={event._id}
                          initial={{ opacity: 0, scale: 1.1, x: 100 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.9, x: -100 }}
                          transition={{ duration: 0.7, ease: "easeInOut" }}
                          className="absolute inset-0 w-full h-full"
                        >
                          <motion.img
                            src={getImageUrl(event.bannerUrl)}
                            alt={event.title}
                            className="w-full h-full object-cover"
                            initial={{ scale: 1.1 }}
                            animate={{ scale: 1 }}
                            transition={{ duration: 10, ease: "linear" }}
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = "/api/placeholder/800/400";
                            }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                          <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8 text-white">
                            <motion.h3
                              initial={{ y: 20, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              transition={{ duration: 0.4, delay: 0.1 }}
                              className="text-2xl md:text-3xl font-semibold mb-2 drop-shadow-lg"
                            >
                              {event.title}
                            </motion.h3>
                            <motion.p
                              initial={{ y: 20, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              transition={{ duration: 0.4, delay: 0.2 }}
                              className="text-sm md:text-base opacity-90 line-clamp-2"
                            >
                              {event.description?.substring(0, 120) || "An inspiring event organized by our amazing team."}
                              ...
                            </motion.p>
                            <motion.div
                              initial={{ y: 20, opacity: 0 }}
                              animate={{ y: 0, opacity: 1 }}
                              transition={{ duration: 0.4, delay: 0.3 }}
                              className="flex items-center mt-3 text-xs md:text-sm opacity-80"
                            >
                              <Calendar className="h-4 w-4 mr-2" />
                              {formatDate(event.startDate)}
                            </motion.div>
                          </div>
                        </motion.div>
                      )
                    ))}
                  </AnimatePresence>
                </div>

                <motion.div
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Previous event"
                    onClick={prevPastEvent}
                    className={`absolute left-4 top-1/2 transform -translate-y-1/2 rounded-full backdrop-blur-md transition-all ${
                      theme === "dark"
                        ? "bg-slate-800/60 text-white hover:bg-slate-700"
                        : "bg-white/80 text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </Button>
                </motion.div>

                <motion.div
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Next event"
                    onClick={nextPastEvent}
                    className={`absolute right-4 top-1/2 transform -translate-y-1/2 rounded-full backdrop-blur-md transition-all ${
                      theme === "dark"
                        ? "bg-slate-800/60 text-white hover:bg-slate-700"
                        : "bg-white/80 text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <ChevronRight className="h-6 w-6" />
                  </Button>
                </motion.div>

                <div className="flex justify-center mt-6 space-x-2">
                  {pastEvents.map((_, index) => (
                    <motion.button
                      key={index}
                      onClick={() => setCurrentPastEventIndex(index)}
                      aria-label={`Go to event ${index + 1}`}
                      className={`h-2.5 rounded-full transition-all duration-300 ${
                        index === currentPastEventIndex
                          ? "bg-purple-400 w-6"
                          : theme === "dark"
                          ? "bg-gray-600 w-2"
                          : "bg-gray-300 w-2"
                      }`}
                      whileHover={{ scale: 1.3 }}
                      whileTap={{ scale: 0.8 }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {/* Enhanced Social Media Section */}
        <motion.section 
          className={`py-20 transition-colors duration-300 ${
            theme === 'dark' ? 'bg-transparent' : 'bg-white'
          }`}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <motion.div 
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 font-medium transition-colors duration-300 ${
                  theme === 'dark'
                    ? 'bg-pink-500/10 text-pink-400'
                    : 'bg-pink-50 text-pink-600'
                }`}
                whileHover={{ scale: 1.05 }}
              >
                <TrendingUp className="h-4 w-4" />
                <span>Follow Us</span>
              </motion.div>
              <h2 className={`text-3xl sm:text-4xl md:text-5xl font-bold mb-6 ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>
                Stay <span className="text-pink-600">Connected</span>
              </h2>
              <p className={`text-base sm:text-lg max-w-2xl mx-auto leading-relaxed ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
              }`}>
                Follow our social media to stay updated with the latest news, events, and opportunities.
              </p>
            </motion.div>

            <motion.div 
              className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={containerVariants}
            >
              {socialLinks.slice(0, 3).map((social, index) => (
                <motion.a
                  key={social.name}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  variants={cardVariants}
                  whileHover="hover"
                  className={`p-6 rounded-2xl transition-all duration-300 group ${
                    theme === 'dark'
                      ? 'bg-slate-800/30 hover:bg-slate-700/40'
                      : 'bg-gray-50 hover:bg-gray-100'
                  } shadow-lg hover:shadow-xl text-center`}
                >
                  <motion.div 
                    className={`w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center transition-colors duration-300 ${
                      theme === 'dark' ? 'bg-slate-700 group-hover:bg-slate-600' : 'bg-white'
                    }`}
                    whileHover={{ 
                      rotate: 360,
                      scale: 1.1,
                      transition: { duration: 0.5 }
                    }}
                  >
                    <social.icon className={`h-6 w-6 ${social.color.replace('hover:', 'group-hover:')}`} />
                  </motion.div>
                  <h3 className={`font-semibold mb-2 ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>
                    {social.name}
                  </h3>
                  <p className={`text-xs ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                  }`}>
                    Follow us on {social.name} for latest updates
                  </p>
                </motion.a>
              ))}
            </motion.div>
          </div>
        </motion.section>

        {/* Enhanced CTA Section */}
        <motion.section 
          className="relative py-20 md:py-32 overflow-hidden"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <motion.div 
            className="absolute inset-0 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 opacity-90"
            animate={{
              background: [
                'linear-gradient(45deg, #2563eb, #7c3aed, #db2777)',
                'linear-gradient(45deg, #db2777, #2563eb, #7c3aed)',
                'linear-gradient(45deg, #7c3aed, #db2777, #2563eb)',
                'linear-gradient(45deg, #2563eb, #7c3aed, #db2777)',
              ],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "linear"
            }}
          />
          <div className="absolute inset-0">
            <motion.div 
              className="absolute top-0 left-0 w-64 h-64 md:w-96 md:h-96 bg-white/10 rounded-full blur-3xl"
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.3, 0.5, 0.3],
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            />
            <motion.div 
              className="absolute bottom-0 right-0 w-64 h-64 md:w-96 md:h-96 bg-white/10 rounded-full blur-3xl"
              animate={{
                scale: [1.2, 1, 1.2],
                opacity: [0.5, 0.3, 0.5],
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 2
              }}
            />
          </div>

          <div className="max-w-4xl mx-auto text-center px-4 sm:px-6 relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <motion.div 
                className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm text-white px-4 py-2 rounded-full mb-6 md:mb-8 font-medium"
                whileHover={{ scale: 1.05 }}
              >
                <Rocket className="h-4 w-4" />
                <span>Join Us Today</span>
              </motion.div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-6 text-white">
                Ready to Make an Impact?
              </h2>
              <p className="text-base md:text-lg mb-8 md:mb-12 text-white/90 leading-relaxed">
                Connect with innovators, attend amazing events, host your own events, and be part of something extraordinary.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 md:gap-6 justify-center">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Button
                    size="lg"
                    className="group px-6 py-3 md:px-8 md:py-4 bg-white text-blue-600 font-semibold rounded-full hover:bg-gray-100 transition-all duration-300 shadow-2xl text-sm md:text-base"
                    asChild
                  >
                    <Link href="/signup">
                      <span className="flex items-center justify-center gap-2">
                        Join Our Community
                        <ArrowRight className="h-4 w-4 md:h-5 md:w-5 group-hover:translate-x-1 transition-transform" />
                      </span>
                    </Link>
                  </Button>
                </motion.div>
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Button
                    size="lg"
                    variant="outline"
                    className="px-6 py-3 md:px-8 md:py-4 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-full border-2 border-white/30 hover:bg-white/20 transition-all duration-300 text-sm md:text-base"
                    asChild
                  >
                    <Link href="/contact">
                      Host an Event
                    </Link>
                  </Button>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </motion.section>

        {/* Enhanced Footer */}
        <motion.footer 
          className={`py-12 transition-colors duration-300 ${
            theme === 'dark' ? 'bg-transparent text-white' : 'bg-gray-900 text-white'
          }`}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <div className="max-w-7xl mx-auto px-6">
            <motion.div 
              className="grid md:grid-cols-4 gap-8 mb-8"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={containerVariants}
            >
              <motion.div variants={itemVariants} className="md:col-span-2">
                <motion.img
                  src="/logo.png"
                  alt="Team Eklavya"
                  className="h-10 mb-4"
                  whileHover={{ scale: 1.05 }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/api/placeholder/150/50';
                  }}
                />
                <p className="text-gray-400 mb-4 max-w-md text-sm">
                  Building a thriving community of innovators, learners, and creators shaping the future together through technology and collaboration.
                </p>
                <div className="flex space-x-3">
                  {socialLinks.map((social, index) => (
                    <motion.a
                      key={social.name}
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`p-2 rounded-lg transition-all duration-300 ${
                        theme === 'dark' ? 'bg-slate-800 text-gray-300' : 'bg-gray-800 text-gray-300'
                      } ${social.color}`}
                      aria-label={social.name}
                      whileHover={{ 
                        scale: 1.2,
                        y: -2,
                      }}
                      whileTap={{ scale: 0.9 }}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ 
                        opacity: 1, 
                        y: 0,
                        transition: { delay: 0.5 + index * 0.1 }
                      }}
                    >
                      <social.icon className="h-4 w-4" />
                    </motion.a>
                  ))}
                </div>
              </motion.div>

              <motion.div variants={itemVariants}>
                <h3 className="font-semibold mb-4 text-sm">Quick Links</h3>
                <div className="space-y-2">
                  {['Home', 'Events', 'About', 'Contact'].map((link, index) => (
                    <motion.div
                      key={link}
                      whileHover={{ x: 5 }}
                      transition={{ type: "spring", stiffness: 400 }}
                    >
                      <Link 
                        href={`/${link.toLowerCase() === 'home' ? '' : link.toLowerCase()}`} 
                        className="block text-gray-400 hover:text-white transition-colors text-sm"
                      >
                        {link}
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              <motion.div variants={itemVariants}>
                <h3 className="font-semibold mb-4 text-sm">Support</h3>
                <div className="space-y-2">
                  {['Help Center', 'Privacy Policy', 'Terms of Service'].map((link, index) => (
                    <motion.div
                      key={link}
                      whileHover={{ x: 5 }}
                      transition={{ type: "spring", stiffness: 400 }}
                    >
                      <Link 
                        href={`/${link.toLowerCase().replace(' ', '-')}`} 
                        className="block text-gray-400 hover:text-white transition-colors text-sm"
                      >
                        {link}
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </motion.div>

            <motion.div 
              className="pt-8 border-t border-gray-800 text-center"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.5 }}
            >
              <p className="text-gray-400 text-sm">
                © {new Date().getFullYear()} Team Eklavya. All rights reserved.
              </p>
            </motion.div>
          </div>
        </motion.footer>

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
      </motion.div>
    </>
  );
}