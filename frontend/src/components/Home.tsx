"use client";

import Head from "next/head";
import { useEffect, useState, useMemo, useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
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

// Three.js component for 3D background
const ThreeScene = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const setCanvasSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    setCanvasSize();
    window.addEventListener('resize', setCanvasSize);

    // Particle system
    const particles: Array<{
      x: number;
      y: number;
      size: number;
      speedX: number;
      speedY: number;
      color: string;
    }> = [];

    // Create particles
    const particleCount = 50;
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 2 + 1,
        speedX: (Math.random() - 0.5) * 0.5,
        speedY: (Math.random() - 0.5) * 0.5,
        color: theme === 'dark' 
          ? `rgba(100, 200, 255, ${Math.random() * 0.3 + 0.1})`
          : `rgba(59, 130, 246, ${Math.random() * 0.2 + 0.1})`
      });
    }

    // Animation loop
    const animate = () => {
      if (!ctx) return;
      
      // Clear with fade effect
      ctx.fillStyle = theme === 'dark' ? 'rgba(15, 23, 42, 0.1)' : 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Update and draw particles
      particles.forEach(particle => {
        particle.x += particle.speedX;
        particle.y += particle.speedY;

        // Wrap around edges
        if (particle.x < 0) particle.x = canvas.width;
        if (particle.x > canvas.width) particle.x = 0;
        if (particle.y < 0) particle.y = canvas.height;
        if (particle.y > canvas.height) particle.y = 0;

        // Draw particle
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = particle.color;
        ctx.fill();

        // Draw connections
        particles.forEach(otherParticle => {
          const dx = particle.x - otherParticle.x;
          const dy = particle.y - otherParticle.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 100) {
            ctx.beginPath();
            ctx.strokeStyle = theme === 'dark' 
              ? `rgba(100, 200, 255, ${0.2 * (1 - distance / 100)})`
              : `rgba(59, 130, 246, ${0.1 * (1 - distance / 100)})`;
            ctx.lineWidth = 0.5;
            ctx.moveTo(particle.x, particle.y);
            ctx.lineTo(otherParticle.x, otherParticle.y);
            ctx.stroke();
          }
        });
      });

      requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', setCanvasSize);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none opacity-40"
    />
  );
};

// Enhanced Double Scrolling Logos Component with Old School Marquee
const DoubleScrollingLogos = () => {
  const { theme } = useTheme();
  
  const partners = [
    { 
      name: "IIT Bombay Techfest", 
      logo: "/iitb.png"
    },
    { name: "IIIT Delhi", logo: "/iiitd-logo.png" },
    { name: "Google Developer Groups", logo: "/gdg-logo.png" },
    { name: "Microsoft Learn", logo: "/microsoft-logo.png" },
    { name: "AWS Educate", logo: "/aws-logo.png" },
    { name: "GitHub Campus", logo: "/github-logo.png" },
    { name: "Hackathon Club", logo: "/hackathon-logo.png" },
    { name: "CodeChef", logo: "/codechef-logo.png" },
    { name: "LeetCode", logo: "/leetcode-logo.png" },
    { name: "Devfolio", logo: "/devfolio-logo.png" },
    { name: "HackerRank", logo: "/hackerrank-logo.png" },
    { name: "MLH", logo: "/mlh-logo.png" },
  ];

  const PartnerLogo = ({ partner, index }: { partner: any; index: number }) => (
    <div className="flex-shrink-0 w-32 h-32 md:w-40 md:h-40 flex items-center justify-center p-4">
      <div className={`w-full h-full flex items-center justify-center rounded-2xl transition-all duration-500 hover:scale-110 group ${
        theme === 'dark' 
          ? 'bg-gradient-to-br from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800' 
          : 'bg-gradient-to-br from-white to-gray-50 hover:from-blue-50 hover:to-purple-50'
      } shadow-lg hover:shadow-2xl border-2 ${
        theme === 'dark' 
          ? 'border-slate-700 hover:border-blue-500' 
          : 'border-gray-200 hover:border-blue-400'
      } relative overflow-hidden`}>
        
        {/* Hover effect overlay */}
        <div className={`absolute inset-0 bg-gradient-to-br from-blue-500/0 to-purple-600/0 group-hover:from-blue-500/10 group-hover:to-purple-600/10 transition-all duration-500 rounded-2xl`} />
        
        {/* Animated border effect */}
        <div className={`absolute inset-0 rounded-2xl bg-gradient-to-r from-transparent via-blue-500/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 -translate-x-full group-hover:translate-x-full`} />
        
        <div className="text-center relative z-10">
          {partner.featured ? (
            <div className="space-y-3">
              {/* IIT Bombay Featured Logo */}
              <div className="w-16 h-16 md:w-20 md:h-20 mx-auto rounded-xl bg-gradient-to-br from-yellow-400 to-orange-500 p-1 shadow-lg">
                <div className="w-full h-full rounded-lg bg-white flex items-center justify-center p-2">
                  <div className="text-center">
                    <div className="text-xs font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
                      IIT Bombay
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs md:text-sm font-bold bg-gradient-to-r from-yellow-500 to-orange-500 bg-clip-text text-transparent">
                  Techfest 2025
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                  Community Partner
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-3 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <div className="text-white text-xs font-bold">{partner.name.split(' ')[0]}</div>
              </div>
              <div className="text-xs md:text-sm font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                {partner.name}
              </div>
            </>
          )}
        </div>

        {/* Shine effect on hover */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
      </div>
    </div>
  );

  return (
    <section className={`py-20 overflow-hidden transition-colors duration-300 ${
      theme === 'dark' ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900' : 'bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50'
    } relative`}>
      
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className={`absolute top-10 left-10 w-32 h-32 rounded-full blur-3xl ${
          theme === 'dark' ? 'bg-blue-600/10' : 'bg-blue-400/20'
        } animate-pulse`} />
        <div className={`absolute bottom-10 right-10 w-48 h-48 rounded-full blur-3xl ${
          theme === 'dark' ? 'bg-purple-600/10' : 'bg-purple-400/20'
        } animate-pulse delay-1000`} />
      </div>

      <div className=" px-4 sm:px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 font-medium transition-colors duration-300 backdrop-blur-sm ${
            theme === 'dark'
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-green-50 text-green-600 border border-green-200'
          }`}>
            <Users className="h-4 w-4" />
            <span>Trusted By The Best</span>
          </div>
          <h2 className={`text-3xl sm:text-4xl md:text-5xl font-bold mb-6 ${
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          }`}>
            Our <span className="text-green-600">Partners</span> & <span className="text-blue-600">Collaborators</span>
          </h2>
          <p className={`text-base sm:text-lg max-w-2xl mx-auto leading-relaxed ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
          }`}>
            Collaborating with leading institutions and organizations to create amazing experiences and drive innovation forward.
          </p>
        </motion.div>

        <div className="relative">
          {/* First row - scroll left with enhanced marquee */}
          <div className="flex mb-8 overflow-hidden py-4">
            <motion.div 
              className="flex"
              animate={{ 
                x: [0, -1920] 
              }}
              transition={{ 
                x: {
                  repeat: Infinity,
                  repeatType: "loop",
                  duration: 40,
                  ease: "linear",
                }
              }}
            >
              {partners.map((partner, index) => (
                <PartnerLogo key={`first-${index}`} partner={partner} index={index} />
              ))}
              {/* Duplicate for seamless loop */}
              {partners.map((partner, index) => (
                <PartnerLogo key={`first-dup-${index}`} partner={partner} index={index} />
              ))}
            </motion.div>
          </div>

          {/* Second row - scroll right with enhanced marquee */}
          <div className="flex overflow-hidden py-4">
            <motion.div 
              className="flex"
              animate={{ 
                x: [-1920, 0] 
              }}
              transition={{ 
                x: {
                  repeat: Infinity,
                  repeatType: "loop",
                  duration: 40,
                  ease: "linear",
                }
              }}
            >
              {partners.map((partner, index) => (
                <PartnerLogo key={`second-${index}`} partner={partner} index={index} />
              ))}
              {/* Duplicate for seamless loop */}
              {partners.map((partner, index) => (
                <PartnerLogo key={`second-dup-${index}`} partner={partner} index={index} />
              ))}
            </motion.div>
          </div>

          {/* Gradient fades for modern look */}
     </div>

        {/* Stats below logos */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-2xl mx-auto"
        >
        </motion.div>
      </div>
    </section>
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

  const { theme, toggleTheme } = useTheme();
  const { scrollYProgress } = useScroll();
  const opacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);

  // Dynamic logo based on theme
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

  // In your useEffect, replace the event fetching logic:
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // Fetch all events
        const eventsRes = await api.get("/events?limit=50"); // Increased limit to get more events
        const eventsData = eventsRes.data.events || [];
        
        // Separate upcoming and past events on the client side
        const now = new Date();
        const upcoming = eventsData
          .filter((event: any) => new Date(event.endDate) >= now)
          .sort((a: any, b: any) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        
        const past = eventsData
          .filter((event: any) => new Date(event.endDate) < now)
          .sort((a: any, b: any) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
        
        setEvents(upcoming.slice(0, 3));
        setPastEvents(past.slice(0, 6)); // Show 6 past events for carousel

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

      <div className={`min-h-screen transition-colors duration-300 ${
        theme === 'dark' 
          ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white' 
          : 'bg-white text-gray-900'
      }`}>

        {/* Hero Section with 3D Background */}
        <section className="relative py-20 md:py-32 overflow-hidden min-h-screen flex items-center">
          {/* Three.js Background */}
          <ThreeScene />
          
          {/* Enhanced Background Animation */}
          <div className={`absolute inset-0 transition-colors duration-300 ${
            theme === 'dark' 
              ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-purple-900/30' 
              : 'bg-gradient-to-br from-blue-50 via-white to-purple-50'
          }`} />
          
          <div className="absolute inset-0 opacity-40">
            <div className={`absolute top-20 left-10 w-48 h-48 sm:w-72 sm:h-72 rounded-full mix-blend-multiply filter blur-3xl animate-blob ${
              theme === 'dark' ? 'bg-blue-600/20' : 'bg-blue-400'
            }`} />
            <div className={`absolute top-40 right-10 w-48 h-48 sm:w-72 sm:h-72 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000 ${
              theme === 'dark' ? 'bg-purple-600/20' : 'bg-purple-400'
            }`} />
            <div className={`absolute bottom-20 left-1/2 w-48 h-48 sm:w-72 sm:h-72 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000 ${
              theme === 'dark' ? 'bg-pink-600/20' : 'bg-pink-400'
            }`} />
          </div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10 w-full">
            <div className="text-center max-w-4xl mx-auto">
              {/* Logo */}
              <div className="mb-8">
                <motion.img
                  src={logoUrl}
                  alt="Team Eklavya"
                  className="mx-auto h-28 w-auto mb-6 drop-shadow-2xl"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.1 }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = theme === 'dark' ? '/logo.png' : '/logo1.png';
                  }}
                />
              </div>

              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-6 sm:mb-8 leading-tight"
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
                className={`text-base sm:text-lg md:text-xl mb-8 sm:mb-12 leading-relaxed ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}
              >
                Building a thriving community of innovators, learners, and creators shaping the future together through technology and collaboration.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center mb-8"
              >
                <Button
                  size="lg"
                  className="group relative bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-purple-600 hover:to-pink-600 px-8 py-3 text-base font-semibold rounded-full overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105 border-0"
                  asChild
                >
                  <Link href="/signup">
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      Join Our Community
                      <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </Link>
                </Button>

                <Button
                  variant="outline"
                  size="lg"
                  className={`px-8 py-3 text-base font-semibold rounded-full transition-all duration-300 hover:scale-105 backdrop-blur-sm ${
                    theme === 'dark'
                      ? 'border-2 border-slate-600 text-gray-300 hover:border-blue-500 hover:text-blue-400 bg-slate-800/50'
                      : 'border-2 border-gray-300 text-gray-700 hover:border-blue-600 hover:text-blue-600 bg-white/80'
                  }`}
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
                className="flex justify-center space-x-4"
              >
                {socialLinks.map((social) => (
                  <a
                    key={social.name}
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`p-3 rounded-full backdrop-blur-sm transition-all duration-300 hover:scale-110 shadow-lg ${
                      theme === 'dark'
                        ? 'bg-slate-800/80 text-gray-300 hover:bg-slate-700'
                        : 'bg-white/80 text-gray-700'
                    } ${social.color}`}
                    aria-label={social.name}
                  >
                    <social.icon className="h-5 w-5" />
                  </a>
                ))}
              </motion.div>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className={`py-16 relative transition-colors duration-300 ${
          theme === 'dark' ? 'bg-slate-900' : 'bg-white'
        }`}>
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
                  <div className="relative inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 mb-3 sm:mb-4">
                    <div className={`absolute inset-0 rounded-2xl opacity-10 group-hover:opacity-20 transition-opacity duration-300 ${
                      theme === 'dark' 
                        ? 'bg-gradient-to-br from-blue-400 to-purple-400' 
                        : 'bg-gradient-to-br from-blue-500 to-purple-500'
                    }`} />
                    <stat.icon className={`relative h-6 w-6 sm:h-7 sm:w-7 transition-transform duration-300 group-hover:scale-110 ${
                      theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
                    }`} />
                  </div>
                  <div className={`text-2xl sm:text-3xl md:text-4xl font-bold mb-1 ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>
                    {loading ? (
                      <Skeleton className={`h-7 w-16 mx-auto ${
                        theme === 'dark' ? 'bg-slate-700' : 'bg-gray-200'
                      }`} />
                    ) : (
                      <>
                        {stat.value}{stat.suffix}
                      </>
                    )}
                  </div>
                  <p className={`font-medium text-xs sm:text-sm ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    {stat.label}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Why Team Eklavya Section */}
        <section className={`py-20 transition-colors duration-300 ${
          theme === 'dark' ? 'bg-slate-800' : 'bg-gray-50'
        }`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 font-medium transition-colors duration-300 ${
                theme === 'dark'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-blue-50 text-blue-600'
              }`}>
                <Target className="h-4 w-4" />
                <span>Why Choose Us</span>
              </div>
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

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {features.map((feature, index) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className={`p-6 rounded-2xl transition-all duration-300 hover:scale-105 ${
                    theme === 'dark'
                      ? 'bg-slate-700/50 hover:bg-slate-700'
                      : 'bg-white hover:bg-gray-100'
                  } shadow-lg hover:shadow-xl`}
                >
                  <div className={`w-12 h-12 rounded-lg mb-4 flex items-center justify-center ${
                    theme === 'dark' ? 'bg-slate-600' : 'bg-gray-100'
                  }`}>
                    <feature.icon className={`h-6 w-6 ${feature.color}`} />
                  </div>
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
            </div>
          </div>
        </section>

        {/* Upcoming Events Section - Conditionally Rendered */}
        {events.length > 0 && (
          <section className={`py-20 transition-colors duration-300 ${
            theme === 'dark' ? 'bg-slate-900' : 'bg-white'
          }`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="text-center mb-16"
              >
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 font-medium transition-colors duration-300 ${
                  theme === 'dark'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-blue-50 text-blue-600'
                }`}>
                  <Calendar className="h-4 w-4" />
                  <span>Upcoming Events</span>
                </div>
                <h2 className={`text-3xl sm:text-4xl md:text-5xl font-bold mb-6 ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  Upcoming <span className="text-blue-600">Events</span>
                </h2>
                <p className={`text-base sm:text-lg max-w-2xl mx-auto leading-relaxed ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  Join our exciting events and connect with like-minded innovators and creators.
                </p>
              </motion.div>

              <div className="grid md:grid-cols-3 gap-8">
                {events.map((event, index) => (
                  <motion.div
                    key={event._id}
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                  >
                    <Card className={`group overflow-hidden border-0 shadow-lg hover:shadow-2xl transition-all duration-500 h-full ${
                      theme === 'dark' 
                        ? 'bg-slate-700 hover:bg-slate-600' 
                        : 'bg-white hover:bg-gray-50'
                    }`}>
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
                        <CardTitle className={`text-lg font-bold line-clamp-2 group-hover:text-blue-600 transition-colors duration-300 ${
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
                        <Button className="w-full group/btn bg-blue-600 hover:bg-blue-700 text-sm" asChild>
                          <Link href={`/events/${event.slug || event._id}`}>
                            View Details
                            <ArrowRight className="ml-2 h-3 w-3 group-hover/btn:translate-x-1 transition-transform duration-300" />
                          </Link>
                        </Button>
                      </CardFooter>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Past Events Carousel */}
        {pastEvents.length > 0 && (
          <section className={`py-20 transition-colors duration-300 ${
            theme === 'dark' ? 'bg-slate-800' : 'bg-gray-50'
          }`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="text-center mb-16"
              >
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 font-medium transition-colors duration-300 ${
                  theme === 'dark'
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'bg-purple-50 text-purple-600'
                }`}>
                  <Award className="h-4 w-4" />
                  <span>Past Events</span>
                </div>
                <h2 className={`text-3xl sm:text-4xl md:text-5xl font-bold mb-6 ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  Our <span className="text-purple-600">Success Stories</span>
                </h2>
                <p className={`text-base sm:text-lg max-w-2xl mx-auto leading-relaxed ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  Take a look at some of our amazing past events and the impact we've created together.
                </p>
              </motion.div>

              <div className="relative max-w-4xl mx-auto">
                <div className="relative h-80 md:h-96 rounded-2xl overflow-hidden">
                  {pastEvents.map((event, index) => (
                    <motion.div
                      key={event._id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ 
                        opacity: index === currentPastEventIndex ? 1 : 0,
                        scale: index === currentPastEventIndex ? 1 : 0.9
                      }}
                      transition={{ duration: 0.5 }}
                      className={`absolute inset-0 w-full h-full ${
                        index === currentPastEventIndex ? 'block' : 'hidden'
                      }`}
                    >
                      <img
                        src={getImageUrl(event.bannerUrl)}
                        alt={event.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/api/placeholder/800/400';
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                        <h3 className="text-xl md:text-2xl font-bold mb-2">{event.title}</h3>
                        <p className="text-sm md:text-base opacity-90 line-clamp-2">
                          {event.description?.substring(0, 120) || "An amazing event by Team Eklavya"}...
                        </p>
                        <div className="flex items-center mt-3 text-xs md:text-sm opacity-80">
                          <Calendar className="h-3 w-3 mr-2" />
                          {formatDate(event.startDate)}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
       

                {/* Carousel Controls */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={prevPastEvent}
                  className={`absolute left-4 top-1/2 transform -translate-y-1/2 backdrop-blur-sm ${
                    theme === 'dark'
                      ? 'bg-slate-800/80 text-white hover:bg-slate-700'
                      : 'bg-white/80 text-gray-700 hover:bg-white'
                  }`}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={nextPastEvent}
                  className={`absolute right-4 top-1/2 transform -translate-y-1/2 backdrop-blur-sm ${
                    theme === 'dark'
                      ? 'bg-slate-800/80 text-white hover:bg-slate-700'
                      : 'bg-white/80 text-gray-700 hover:bg-white'
                  }`}
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>

                {/* Indicators */}
                <div className="flex justify-center mt-6 space-x-2">
                  {pastEvents.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentPastEventIndex(index)}
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${
                        index === currentPastEventIndex
                          ? 'bg-blue-600 w-6'
                          : theme === 'dark'
                          ? 'bg-gray-600'
                          : 'bg-gray-300'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Enhanced Double Scrolling Logos with Old School Marquee */}
        {/*<DoubleScrollingLogos />*/}
 <NewsletterEvents />
        {/* Social Media Section */}
        <section className={`py-20 transition-colors duration-300 ${
          theme === 'dark' ? 'bg-slate-900' : 'bg-white'
        }`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 font-medium transition-colors duration-300 ${
                theme === 'dark'
                  ? 'bg-pink-500/20 text-pink-400'
                  : 'bg-pink-50 text-pink-600'
              }`}>
                <TrendingUp className="h-4 w-4" />
                <span>Follow Us</span>
              </div>
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

            <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              {socialLinks.slice(0, 3).map((social, index) => (
                <motion.a
                  key={social.name}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className={`p-6 rounded-2xl transition-all duration-300 hover:scale-105 group ${
                    theme === 'dark'
                      ? 'bg-slate-800 hover:bg-slate-700'
                      : 'bg-gray-50 hover:bg-gray-100'
                  } shadow-lg hover:shadow-xl text-center`}
                >
                  <div className={`w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center transition-colors duration-300 ${
                    theme === 'dark' ? 'bg-slate-700 group-hover:bg-slate-600' : 'bg-white'
                  }`}>
                    <social.icon className={`h-6 w-6 ${social.color.replace('hover:', 'group-hover:')}`} />
                  </div>
                  <h3 className={`font-semibold mb-2 ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>
                    {social.name}
                  </h3>
                  <p className={`text-xs ${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    Follow us on {social.name} for latest updates
                  </p>
                </motion.a>
              ))}
            </div>
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
                <Rocket className="h-4 w-4" />
                <span>Join Us Today</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-6 text-white">
                Ready to Make an Impact?
              </h2>
              <p className="text-base md:text-lg mb-8 md:mb-12 text-white/90 leading-relaxed">
                Connect with innovators, attend amazing events, host your own events, and be part of something extraordinary.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 md:gap-6 justify-center">
                <Button
                  size="lg"
                  className="group px-6 py-3 md:px-8 md:py-4 bg-white text-blue-600 font-semibold rounded-full hover:bg-gray-100 transition-all duration-300 hover:scale-105 shadow-2xl text-sm md:text-base"
                  asChild
                >
                  <Link href="/signup">
                    <span className="flex items-center justify-center gap-2">
                      Join Our Community
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
                  <Link href="/contact">
                    Host an Event
                  </Link>
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Footer */}
        <footer className={`py-12 transition-colors duration-300 ${
          theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-gray-900 text-white'
        }`}>
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid md:grid-cols-4 gap-8 mb-8">
              {/* Brand */}
              <div className="md:col-span-2">
                <img
                  src="/logo.png"
                  alt="Team Eklavya"
                  className="h-10 mb-4"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/api/placeholder/150/50';
                  }}
                />
                <p className="text-gray-400 mb-4 max-w-md text-sm">
                  Building a thriving community of innovators, learners, and creators shaping the future together through technology and collaboration.
                </p>
                <div className="flex space-x-3">
                  {socialLinks.map((social) => (
                    <a
                      key={social.name}
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`p-2 rounded-lg transition-all duration-300 hover:scale-110 ${
                        theme === 'dark' ? 'bg-slate-800 text-gray-300' : 'bg-gray-800 text-gray-300'
                      } ${social.color}`}
                      aria-label={social.name}
                    >
                      <social.icon className="h-4 w-4" />
                    </a>
                  ))}
                </div>
              </div>

              {/* Quick Links */}
              <div>
                <h3 className="font-semibold mb-4 text-sm">Quick Links</h3>
                <div className="space-y-2">
                  <Link href="/" className="block text-gray-400 hover:text-white transition-colors text-sm">Home</Link>
                  <Link href="/events" className="block text-gray-400 hover:text-white transition-colors text-sm">Events</Link>
                  <Link href="/about" className="block text-gray-400 hover:text-white transition-colors text-sm">About</Link>
                  <Link href="/contact" className="block text-gray-400 hover:text-white transition-colors text-sm">Contact</Link>
                </div>
              </div>

              {/* Support */}
              <div>
                <h3 className="font-semibold mb-4 text-sm">Support</h3>
                <div className="space-y-2">
                  <Link href="/help" className="block text-gray-400 hover:text-white transition-colors text-sm">Help Center</Link>
                  <Link href="/privacy" className="block text-gray-400 hover:text-white transition-colors text-sm">Privacy Policy</Link>
                  <Link href="/terms" className="block text-gray-400 hover:text-white transition-colors text-sm">Terms of Service</Link>
                </div>
              </div>
            </div>

            <div className="pt-8 border-t border-gray-800 text-center">
              <p className="text-gray-400 text-sm">
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