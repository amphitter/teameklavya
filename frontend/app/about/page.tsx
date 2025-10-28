"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Users, 
  Target, 
  Heart, 
  Rocket,
  Calendar,
  Code,
  BookOpen,
  Award,
  ArrowRight,
  Instagram, 
  Twitter, 
  Github, 
  Linkedin,
  Sparkles,
  Zap,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

// Team Member Interface and Data
interface TeamMember {
  id: number;
  name: string;
  role: string;
  image: string;
  description: string;
  socialLinks: {
    instagram?: string;
    twitter?: string;
    github?: string;
    linkedin?: string;
  };
  skills: string[];
}

const teamMembers: TeamMember[] = [
  {
    id: 4,
    name: "Ayush Kumar Jha",
    role: "Founder",
    image: "https://hackcraft20.vercel.app/ayush1.jpeg",
    description: "Founder and core visionary, driving the team's mission, growth, and innovation roadmap.",
    socialLinks: {
      linkedin: "https://www.linkedin.com/in/ayush-kumar-chahar-a76175329/",
      instagram: "https://www.instagram.com/lifepaletteadventures/"
    },
    skills: ["Leadership", "Vision", "Innovation", "Team Building"],
  },
  {
    id: 1,
    name: "Devansh Singh",
    role: "System Strategist & Outreach Lead",
    image: "https://teameklavya.onrender.com/uploads/team/Devansh.png",
    description: "Leads the team vision, technical roadmap, and overall execution strategy. Builds external relationships, represents the team, and manages collaborations.",
    socialLinks: {
      instagram: "https://www.instagram.com/amp.hitter/",
      twitter: "https://x.com/amphitter",
      github: "https://github.com/amphitter",
      linkedin: "https://www.linkedin.com/in/devansh-singh-amphitter/"
    },
    skills: ["Leadership", "Strategy", "Full Stack", "AI/ML"],
  },
  {
    id: 6,
    name: "Hritik Kumar Singh",
    role: "Technical Lead",
    image: "https://teameklavya.onrender.com/uploads/team/Hritik-Kumar-Singh.png",
    description: "Heads development, ensures smooth backend/frontend integration, and handles tech stack decisions.",
    socialLinks: {
      instagram: "https://www.instagram.com/lavish_khatkarya/",
      github: "https://github.com/hritik",
      linkedin: "https://linkedin.com/in/hritik"
    },
    skills: ["Full Stack", "Integration", "Architecture", "Leadership"],
  },
  {
    id: 7,
    name: "Kunal Biserwal",
    role: "Operations & Discipline Lead",
    image: "https://teameklavya.onrender.com/uploads/team/Kunal-Biserwal.png",
    description: "Manages live event coordination, internal protocols, and team logistics.",
    socialLinks: {
      instagram: "https://www.instagram.com/kunal_biserwal/",
      linkedin: "https://www.linkedin.com/in/kunal-biserwal-b2a70528a/"
    },
    skills: ["Operations", "Logistics", "Discipline", "Team Management"],
  },
  {
    id: 9,
    name: "Manya Kanojia",
    role: "Website Design & Content Producer",
    image: "https://teameklavya.onrender.com/uploads/team/Manya-Kanojia.png",
    description: "Captures event moments, creates digital content, and manages visual branding on social media.",
    socialLinks: {
      instagram: "https://www.instagram.com/_heymanya/",
      linkedin: "https://www.linkedin.com/in/manya-kanojia-7a0334290/"
    },
    skills: ["Design", "Content", "Branding", "Photography"],
  },
  {
    id: 8,
    name: "Luv Jangra",
    role: "Tech Developer",
    image: "https://teameklavya.onrender.com/uploads/team/Luv-Jangra.png",
    description: "Leads development and integration, experimentation, and deployment of tech-related solutions.",
    socialLinks: {
      linkedin: "https://linkedin.com/in/luvjangra",
      github: "https://github.com/luvjangra"
    },
    skills: ["MERN", "Python", "Development", "Deployment"],
  },
  {
    id: 11,
    name: "Vishnu Kumar",
    role: "Community Mentor & Strategic Advisor",
    image: "https://teameklavya.onrender.com/uploads/team/Vishnu-Kumar.png",
    description: "Guides the team, maintains key community ties, and plays a senior consultative role.",
    socialLinks: {
      linkedin: "https://linkedin.com/in/vishnu",
      github: "https://github.com/vishnu"
    },
    skills: ["Mentorship", "Strategy", "Community", "Leadership"],
  },
  {
    id: 12,
    name: "Sahil",
    role: "AI/ML Developer",
    image: "https://teameklavya.onrender.com/uploads/team/Sahil.png",
    description: "Developing intelligent systems and machine learning models to solve complex problems.",
    socialLinks: {
      instagram: "https://www.instagram.com/_sahil__sh/",
      linkedin: "https://www.linkedin.com/in/sahil-sharma-09b82828a/",
      github: "https://github.com/sahilsh9220git"
    },
    skills: ["Python", "TensorFlow", "Data Science", "AI"],
  },
  {
    id: 2,
    name: "Ansh Kumar",
    role: "Communication & Participant Manager",
    image: "https://teameklavya.onrender.com/uploads/team/Ansh-Kumar.png",
    description: "Handles participant queries, manages internal and external communication during events.",
    socialLinks: {
      instagram: "https://www.instagram.com/extrovert_anshuu/",
      linkedin: "https://www.linkedin.com/in/ansh-kumar-95a84a28a/"
    },
    skills: ["Communication", "Coordination", "Public Relations", "Event Management"],
  },
  {
    id: 3,
    name: "Ayush",
    role: "Media & Campaign Strategist",
    image: "https://teameklavya.onrender.com/uploads/team/Ayush.png",
    description: "Crafts digital strategies, runs campaigns, and coordinates with content teams.",
    socialLinks: {
      linkedin: "https://www.linkedin.com/in/ayush7989/",
      instagram: "https://www.instagram.com/jat_.537/"
    },
    skills: ["Digital Strategy", "Social Media", "Marketing", "Content Coordination"],
  },
  {
    id: 5,
    name: "Divya Jangra",
    role: "Program Coordinator & Registration Lead",
    image: "https://teameklavya.onrender.com/uploads/team/Divya-Jangra.png",
    description: "Oversees event structure, registration processes, data handling, and backend entry.",
    socialLinks: {
      instagram: "https://www.instagram.com/divyajangra12/",
      linkedin: "https://www.linkedin.com/in/divya-801387297/"
    },
    skills: ["Coordination", "Registration", "Management", "Backend Support"],
  },
  {
    id: 10,
    name: "Mohit",
    role: "Tech Lead",
    image: "https://teameklavya.onrender.com/uploads/team/Mohit.png",
    description: "Leads backend and technical development, ensuring scalability and reliability.",
    socialLinks: {
      linkedin: "https://linkedin.com/in/mohit",
      github: "https://github.com/mohit"
    },
    skills: ["Node.js", "Python", "Backend", "Scalability"],
  },
  {
    id: 13,
    name: "Pritika",
    role: "Creative Head & Design Architect",
    image: "https://hackcraft20.vercel.app/pritika.jpeg",
    description: "Leads artistic direction, creates event themes, UI/UX prototypes, and promotional graphics.",
    socialLinks: {
      instagram: "https://www.instagram.com/pritikagosain/",
      linkedin: "https://www.linkedin.com/in/pritika-49748b31a/"
    },
    skills: ["UI/UX", "Creative Direction", "Design", "Branding"],
  }
];

const socialIcons = {
  instagram: Instagram,
  twitter: Twitter,
  github: Github,
  linkedin: Linkedin
};

// Enhanced Image component with better error handling
const TeamImage = ({ src, alt, className }: { src: string; alt: string; className: string }) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  // Generate initials for placeholder
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Generate a consistent color based on name
  const getColorFromName = (name: string) => {
    const colors = [
      'from-blue-500 to-blue-600', 
      'from-green-500 to-green-600', 
      'from-purple-500 to-purple-600', 
      'from-red-500 to-red-600',
      'from-yellow-500 to-yellow-600', 
      'from-pink-500 to-pink-600', 
      'from-indigo-500 to-indigo-600', 
      'from-teal-500 to-teal-600'
    ];
    const index = name.length % colors.length;
    return colors[index];
  };

  return (
    <div className="relative">
      {imageLoading && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-300 animate-pulse rounded-lg flex items-center justify-center">
          <div className={`w-full h-full bg-gradient-to-br ${getColorFromName(alt)} rounded-lg flex items-center justify-center`}>
            <span className="text-white font-bold text-2xl">
              {getInitials(alt)}
            </span>
          </div>
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={`${className} ${imageLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
        onError={() => {
          setImageError(true);
          setImageLoading(false);
        }}
        onLoad={() => setImageLoading(false)}
        loading="lazy"
        decoding="async"
      />
      {imageError && (
        <div className={`absolute inset-0 bg-gradient-to-br ${getColorFromName(alt)} rounded-lg flex items-center justify-center`}>
          <span className="text-white font-bold text-2xl">
            {getInitials(alt)}
          </span>
        </div>
      )}
    </div>
  );
};

// Team Card Component for Slider
const TeamCard = ({ 
  member, 
  isActive = false 
}: { 
  member: TeamMember;
  isActive?: boolean;
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: isActive ? 1 : 0.7, scale: isActive ? 1 : 0.95 }}
      transition={{ duration: 0.3 }}
      className={`relative bg-white rounded-2xl overflow-hidden shadow-lg transition-all duration-500 border border-gray-100 h-full flex flex-col ${
        isActive ? 'shadow-2xl transform scale-100' : 'shadow-md transform scale-95'
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Image Container */}
      <div className="relative h-72 overflow-hidden bg-gradient-to-br from-gray-100 to-gray-50 flex-shrink-0">
        <TeamImage
          src={member.image}
          alt={member.name}
          className="w-full h-full object-cover object-center transition-transform duration-700 hover:scale-110"
        />
        
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity duration-500" />
        
        {/* Social Links Overlay */}
        <div className={`absolute bottom-4 left-0 right-0 flex justify-center gap-3 transition-all duration-500 ${
          hovered ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'
        }`}>
          {Object.entries(member.socialLinks).map(([platform, url]) => {
            const IconComponent = socialIcons[platform as keyof typeof socialIcons];
            return (
              <a
                key={platform}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 bg-white/95 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-blue-600 hover:scale-110 transition-all duration-300 shadow-lg"
                aria-label={`Visit ${member.name}'s ${platform}`}
              >
                <IconComponent className="h-4 w-4 text-gray-700 hover:text-white transition-colors" />
              </a>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="p-6 flex-grow flex flex-col">
        <h3 className="text-xl font-bold text-gray-900 mb-1 hover:text-blue-600 transition-colors duration-300 line-clamp-1">
          {member.name}
        </h3>
        <p className="text-sm font-medium text-blue-600 mb-3 line-clamp-1">
          {member.role}
        </p>
        <p className="text-sm text-gray-600 leading-relaxed mb-4 line-clamp-3 flex-grow">
          {member.description}
        </p>
        
        {/* Skills Tags */}
        <div className="flex flex-wrap gap-2">
          {member.skills.slice(0, 3).map((skill) => (
            <span
              key={skill}
              className="px-3 py-1 bg-gray-50 text-gray-700 text-xs font-medium rounded-full border border-gray-200 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 transition-colors duration-300"
            >
              {skill}
            </span>
          ))}
          {member.skills.length > 3 && (
            <span className="px-3 py-1 bg-gray-50 text-gray-500 text-xs font-medium rounded-full border border-gray-200">
              +{member.skills.length - 3}
            </span>
          )}
        </div>
      </div>

      {/* Active State Border */}
      {isActive && (
        <div className="absolute inset-0 rounded-2xl border-2 border-blue-600 pointer-events-none" />
      )}
    </motion.div>
  );
};

// Team Slider Component
const TeamSlider = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [cardsToShow, setCardsToShow] = useState(4);

  // Calculate cards to show based on screen size
  const getCardsToShow = () => {
    if (typeof window === 'undefined') return 4;
    const width = window.innerWidth;
    if (width < 640) return 1;
    if (width < 768) return 2;
    if (width < 1024) return 3;
    return 4;
  };

  useEffect(() => {
    const handleResize = () => {
      setCardsToShow(getCardsToShow());
      // Reset to first slide on resize to avoid empty slides
      setCurrentIndex(0);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-play functionality
  useEffect(() => {
    if (!autoPlay) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => 
        (prev + 1) % Math.ceil(teamMembers.length / cardsToShow)
      );
    }, 4000);

    return () => clearInterval(interval);
  }, [autoPlay, cardsToShow]);

  const nextSlide = useCallback(() => {
    setCurrentIndex((prev) => 
      (prev + 1) % Math.ceil(teamMembers.length / cardsToShow)
    );
    setAutoPlay(false);
    setTimeout(() => setAutoPlay(true), 10000);
  }, [cardsToShow]);

  const prevSlide = useCallback(() => {
    setCurrentIndex((prev) => 
      (prev - 1 + Math.ceil(teamMembers.length / cardsToShow)) % Math.ceil(teamMembers.length / cardsToShow)
    );
    setAutoPlay(false);
    setTimeout(() => setAutoPlay(true), 10000);
  }, [cardsToShow]);

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
    setAutoPlay(false);
    setTimeout(() => setAutoPlay(true), 10000);
  };

  // Get current slide members
  const getCurrentSlideMembers = () => {
    const start = currentIndex * cardsToShow;
    return teamMembers.slice(start, start + cardsToShow);
  };

  const totalSlides = Math.ceil(teamMembers.length / cardsToShow);
  const currentMembers = getCurrentSlideMembers();

  return (
    <section className="py-24 bg-white relative overflow-hidden">
      {/* Background Decoration */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-50/50 to-white pointer-events-none" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-full mb-6 font-medium">
            <Sparkles className="h-4 w-4" />
            <span>Our Team</span>
          </div>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            Meet the <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Innovators</span>
          </h2>
          <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Passionate minds working together to build the future of technology
          </p>
        </motion.div>

        {/* Slider Container */}
        <div className="relative">
          {/* Navigation Buttons */}
          <button
            onClick={prevSlide}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 bg-white/90 backdrop-blur-sm rounded-full shadow-lg flex items-center justify-center hover:bg-white hover:scale-110 transition-all duration-300 border border-gray-200"
            aria-label="Previous slide"
          >
            <ChevronLeft className="h-6 w-6 text-gray-700" />
          </button>

          <button
            onClick={nextSlide}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 bg-white/90 backdrop-blur-sm rounded-full shadow-lg flex items-center justify-center hover:bg-white hover:scale-110 transition-all duration-300 border border-gray-200"
            aria-label="Next slide"
          >
            <ChevronRight className="h-6 w-6 text-gray-700" />
          </button>

          {/* Slides */}
          <div className="overflow-hidden px-4">
            <motion.div
              key={currentIndex}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              className={`grid gap-6 ${
                cardsToShow === 1 ? 'grid-cols-1 max-w-sm mx-auto' :
                cardsToShow === 2 ? 'grid-cols-2 max-w-4xl mx-auto' :
                cardsToShow === 3 ? 'grid-cols-3' : 'grid-cols-4'
              }`}
            >
              {currentMembers.map((member) => (
                <TeamCard
                  key={`${member.id}-${currentIndex}`}
                  member={member}
                  isActive={true}
                />
              ))}
            </motion.div>
          </div>

          {/* Dots Indicator */}
          {totalSlides > 1 && (
            <div className="flex justify-center mt-12 gap-3">
              {Array.from({ length: totalSlides }).map((_, index) => (
                <button
                  key={index}
                  onClick={() => goToSlide(index)}
                  className={`w-3 h-3 rounded-full transition-all duration-300 ${
                    index === currentIndex 
                      ? 'bg-blue-600 w-8' 
                      : 'bg-gray-300 hover:bg-gray-400'
                  }`}
                  aria-label={`Go to slide ${index + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

// Stats Component
const StatsSection = ({ stats }: { stats: { members: number; events: number; Groups: number; communities: number } }) => {
  const statItems = useMemo(() => [
    { icon: Users, label: "Members", value: stats.members, suffix: "+" },
    { icon: Calendar, label: "Events", value: stats.events, suffix: "+" },
    { icon: Code, label: "Projects", value: stats.Groups, suffix: "+" },
    { icon: Award, label: "Communities", value: stats.communities, suffix: "" }
  ], [stats]);

  return (
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
                {stat.value}{stat.suffix}
              </div>
              <p className="text-gray-600 font-medium text-sm sm:text-lg">{stat.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

// Main About Page Component
export default function AboutPage() {
  const [stats] = useState({
    members: 900,
    events: 15,
    Groups: 4,
    communities: 3
  });

  const values = useMemo(() => [
    {
      icon: Users,
      title: "Community First",
      description: "We believe in the power of community to drive innovation and learning through collaboration.",
      gradient: "from-blue-500 to-cyan-500"
    },
    {
      icon: Target,
      title: "Excellence",
      description: "Striving for excellence in everything we do, from workshops to hackathons and beyond.",
      gradient: "from-purple-500 to-pink-500"
    },
    {
      icon: Heart,
      title: "Passion",
      description: "Driven by our passion for technology and making a positive impact in the world.",
      gradient: "from-red-500 to-orange-500"
    },
    {
      icon: Rocket,
      title: "Innovation",
      description: "Constantly pushing boundaries and exploring new technologies and methodologies.",
      gradient: "from-green-500 to-teal-500"
    }
  ], []);

  const activities = useMemo(() => [
    {
      icon: Code,
      title: "Hackathons",
      description: "Regular coding competitions to solve real-world problems and build innovative solutions.",
      gradient: "from-blue-500 to-cyan-500"
    },
    {
      icon: BookOpen,
      title: "Workshops",
      description: "Hands-on learning sessions on cutting-edge technologies and development practices.",
      gradient: "from-green-500 to-emerald-500"
    },
    {
      icon: Users,
      title: "Seminars",
      description: "Expert talks and knowledge-sharing sessions with industry professionals and alumni.",
      gradient: "from-purple-500 to-violet-500"
    },
    {
      icon: Calendar,
      title: "Meetups",
      description: "Community gatherings to network, collaborate, and share ideas with like-minded peers.",
      gradient: "from-orange-500 to-red-500"
    }
  ], []);

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="relative py-20 md:py-32 overflow-hidden">
        {/* Optimized Background Animation */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-purple-50" />
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-20 left-10 w-48 h-48 sm:w-72 sm:h-72 bg-blue-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob" />
          <div className="absolute top-40 right-10 w-48 h-48 sm:w-72 sm:h-72 bg-purple-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000" />
          <div className="absolute bottom-20 left-1/2 w-48 h-48 sm:w-72 sm:h-72 bg-pink-400 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000" />
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

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-6 sm:mb-8 leading-tight text-gray-900"
            >
              About{" "}
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
              A vibrant community of students, coders, and tech enthusiasts passionate about 
              learning, collaborating, and building innovative projects that shape the future.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center"
            >
              <button className="group relative px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-full overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105 text-sm sm:text-base">
                <span className="relative z-10 flex items-center justify-center gap-2">
                  Join Our Events
                  <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 group-hover:translate-x-1 transition-transform" />
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-pink-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              </button>

              <button className="px-6 py-3 sm:px-8 sm:py-4 bg-white text-gray-900 font-semibold rounded-full border-2 border-gray-200 hover:border-blue-600 hover:text-blue-600 transition-all duration-300 hover:scale-105 shadow-lg text-sm sm:text-base">
                Get In Touch
              </button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <StatsSection stats={stats} />

      {/* Mission & Vision */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-white to-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-2 gap-12 md:gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-full mb-6 font-medium">
                <Target className="h-4 w-4" />
                <span>Our Mission</span>
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 mb-6">
                Empowering the <span className="text-blue-600">Next Generation</span>
              </h2>
              <p className="text-base sm:text-lg text-gray-600 mb-6 leading-relaxed">
                To create a thriving ecosystem where students can learn, innovate, and grow together. 
                We empower the next generation of tech leaders through hands-on experiences, mentorship, 
                and collaborative projects.
              </p>
              <p className="text-base sm:text-lg text-gray-600 mb-8 leading-relaxed">
                Team Eklavya is more than just a community - it's a movement dedicated to fostering 
                innovation, creativity, and technical excellence among students and tech enthusiasts.
              </p>
              <button className="group inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-semibold rounded-full hover:bg-blue-700 transition-all duration-300 hover:scale-105 shadow-lg text-sm sm:text-base">
                Explore Our Work
                <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="relative"
            >
              <div className="relative bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 rounded-3xl p-8 md:p-12 text-white shadow-2xl overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 md:w-64 md:h-64 bg-white/10 rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 w-48 h-48 md:w-64 md:h-64 bg-white/10 rounded-full blur-3xl" />
                
                <div className="relative z-10">
                  <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full mb-6 font-medium">
                    <Rocket className="h-4 w-4" />
                    <span>Our Vision</span>
                  </div>
                  <h3 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-6">
                    Leading Innovation in Education
                  </h3>
                  <p className="text-base md:text-lg text-white/90 leading-relaxed">
                    To be the premier student-led community that bridges the gap between academic learning 
                    and real-world technological innovation, creating opportunities for every member to 
                    excel and make meaningful contributions to the tech industry.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="py-16 md:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12 md:mb-16"
          >
            <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-full mb-6 font-medium">
              <Heart className="h-4 w-4" />
              <span>Our Values</span>
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 mb-6">
              What We <span className="text-blue-600">Stand For</span>
            </h2>
            <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto">
              The principles that guide everything we do and every community we build.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
            {values.map((value, index) => (
              <motion.div
                key={value.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="group relative"
              >
                <div className="relative bg-white rounded-2xl p-6 md:p-8 shadow-lg hover:shadow-2xl transition-all duration-500 border border-gray-100 overflow-hidden h-full">
                  <div className={`absolute inset-0 bg-gradient-to-br ${value.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-500`} />
                  
                  <div className="relative z-10">
                    <div className={`inline-flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br ${value.gradient} mb-6 group-hover:scale-110 transition-transform duration-300 shadow-lg`}>
                      <value.icon className="h-6 w-6 md:h-8 md:w-8 text-white" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-4 group-hover:text-blue-600 transition-colors duration-300">
                      {value.title}
                    </h3>
                    <p className="text-gray-600 leading-relaxed text-sm md:text-base">
                      {value.description}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Activities Section */}
      <section className="py-16 md:py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12 md:mb-16"
          >
            <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-full mb-6 font-medium">
              <Sparkles className="h-4 w-4" />
              <span>What We Do</span>
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 mb-6">
              Our <span className="text-blue-600">Activities</span>
            </h2>
            <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto">
              We organize various activities and events to help members grow their skills and network with industry experts.
            </p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
            {activities.map((activity, index) => (
              <motion.div
                key={activity.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="group relative"
              >
                <div className="relative bg-white rounded-2xl p-6 md:p-8 shadow-lg hover:shadow-2xl transition-all duration-500 border border-gray-100 overflow-hidden h-full">
                  <div className={`absolute inset-0 bg-gradient-to-br ${activity.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-500`} />
                  
                  <div className="relative z-10">
                    <div className={`inline-flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-xl bg-gradient-to-br ${activity.gradient} mb-6 group-hover:scale-110 transition-transform duration-300 shadow-lg`}>
                      <activity.icon className="h-6 w-6 md:h-7 md:w-7 text-white" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-4 group-hover:text-blue-600 transition-colors duration-300">
                      {activity.title}
                    </h3>
                    <p className="text-gray-600 leading-relaxed text-sm md:text-base">
                      {activity.description}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Team Section */}
      <TeamSlider />

      {/* CTA Section */}
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
              Become part of Team Eklavya and start your journey of learning, innovation, and growth.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 md:gap-6 justify-center">
              <button className="group px-6 py-3 md:px-8 md:py-4 bg-white text-blue-600 font-semibold rounded-full hover:bg-gray-100 transition-all duration-300 hover:scale-105 shadow-2xl text-sm md:text-base">
                <span className="flex items-center justify-center gap-2">
                  Join Now
                  <ArrowRight className="h-4 w-4 md:h-5 md:w-5 group-hover:translate-x-1 transition-transform" />
                </span>
              </button>
              <button className="px-6 py-3 md:px-8 md:py-4 bg-white/10 backdrop-blur-sm text-white font-semibold rounded-full border-2 border-white/30 hover:bg-white/20 transition-all duration-300 hover:scale-105 text-sm md:text-base">
                Explore Events
              </button>
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