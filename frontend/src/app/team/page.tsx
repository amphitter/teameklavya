"use client";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Instagram, 
  Twitter, 
  Github, 
  Linkedin,
  ArrowRight,
  Code,
  Cpu,
  Globe,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause
} from "lucide-react";
import { useState, useEffect } from "react";

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
  stats: {
    projects: string;
    experience: string;
    passion: string;
  };
}

const teamMembers: TeamMember[] = [
  {
    id: 1,
    name: "Devansh Singh",
    role: "Full Stack & AI Developer",
    image: `${process.env.NEXT_PUBLIC_BACKEND_URL}/uploads/team/Devansh.png`,
    description: "Passionate about building intelligent, scalable web applications that solve real-world problems with cutting-edge technology.",
    socialLinks: {
      instagram: "https://www.instagram.com/amp.hitter/",
      twitter: "https://x.com/amphitter",
      github: "https://github.com/amphitter",
      linkedin: "https://www.linkedin.com/in/devansh-singh-amphitter/"
    },
    skills: ["Full Stack", "AI/ML", "Web Development", "Innovation"],
    stats: {
      projects: "50+",
      experience: "3+ Years",
      passion: "100%"
    }
  },
  {
    id: 2,
    name: "Ansh Kumar",
    role: "Full Stack Developer",
    image: `${process.env.NEXT_PUBLIC_BACKEND_URL}/uploads/team/Ansh-Kumar.png`,
    description: "Creative developer focused on building beautiful user interfaces and seamless user experiences.",
    socialLinks: {
      github: "https://github.com/anshkumar",
      linkedin: "https://linkedin.com/in/anshkumar"
    },
    skills: ["Frontend", "UI/UX", "React", "Design"],
    stats: {
      projects: "30+",
      experience: "2+ Years",
      passion: "100%"
    }
  },
  {
    id: 3,
    name: "Ayush",
    role: "Backend Developer",
    image: `${process.env.NEXT_PUBLIC_BACKEND_URL}/uploads/team/Ayush.png`,
    description: "Backend specialist building robust and scalable server architectures for modern applications.",
    socialLinks: {
      github: "https://github.com/ayush",
      linkedin: "https://linkedin.com/in/ayush"
    },
    skills: ["Backend", "APIs", "Database", "Cloud"],
    stats: {
      projects: "40+",
      experience: "3+ Years",
      passion: "100%"
    }
  },
  {
    id: 4,
    name: "Divya Jangra",
    role: "UI/UX Designer",
    image: `${process.env.NEXT_PUBLIC_BACKEND_URL}/uploads/team/Divya-Jangra.png`,
    description: "Creating intuitive and beautiful user experiences that make technology accessible to everyone.",
    socialLinks: {
      instagram: "https://instagram.com/divyajangra",
      linkedin: "https://linkedin.com/in/divyajangra"
    },
    skills: ["UI/UX", "Figma", "Prototyping", "Research"],
    stats: {
      projects: "25+",
      experience: "2+ Years",
      passion: "100%"
    }
  },
  {
    id: 5,
    name: "Hritik Kumar Singh",
    role: "Mobile Developer",
    image: `${process.env.NEXT_PUBLIC_BACKEND_URL}/uploads/team/Hritik-Kumar-Singh.png`,
    description: "Building cross-platform mobile applications that deliver exceptional performance and user experience.",
    socialLinks: {
      github: "https://github.com/hritik",
      linkedin: "https://linkedin.com/in/hritik"
    },
    skills: ["React Native", "Flutter", "iOS", "Android"],
    stats: {
      projects: "35+",
      experience: "3+ Years",
      passion: "100%"
    }
  },
  {
    id: 6,
    name: "Kunal Biserwal",
    role: "DevOps Engineer",
    image: `${process.env.NEXT_PUBLIC_BACKEND_URL}/uploads/team/Kunal-Biserwal.png`,
    description: "Automating deployment pipelines and ensuring scalable infrastructure for high-performance applications.",
    socialLinks: {
      github: "https://github.com/kunal",
      linkedin: "https://linkedin.com/in/kunal"
    },
    skills: ["DevOps", "AWS", "Docker", "CI/CD"],
    stats: {
      projects: "20+",
      experience: "2+ Years",
      passion: "100%"
    }
  },
  {
    id: 7,
    name: "Luv Jangra",
    role: "Full Stack Developer",
    image: `${process.env.NEXT_PUBLIC_BACKEND_URL}/uploads/team/Luv-Jangra.png`,
    description: "Versatile developer passionate about building end-to-end solutions from concept to deployment.",
    socialLinks: {
      github: "https://github.com/luvjangra",
      linkedin: "https://linkedin.com/in/luvjangra"
    },
    skills: ["MERN Stack", "Python", "Startups", "Mentoring"],
    stats: {
      projects: "45+",
      experience: "4+ Years",
      passion: "100%"
    }
  },
  {
    id: 8,
    name: "Manya Kanojia",
    role: "Product Manager",
    image: `${process.env.NEXT_PUBLIC_BACKEND_URL}/uploads/team/Manya-Kanojia.png`,
    description: "Bridging the gap between technical teams and user needs to create products that people love.",
    socialLinks: {
      linkedin: "https://linkedin.com/in/manyakanodia"
    },
    skills: ["Product Strategy", "Agile", "User Research", "Analytics"],
    stats: {
      projects: "15+",
      experience: "3+ Years",
      passion: "100%"
    }
  },
  {
    id: 9,
    name: "Mohit",
    role: "Backend Developer",
    image: `${process.env.NEXT_PUBLIC_BACKEND_URL}/uploads/team/Mohit.png`,
    description: "Building scalable backend systems and APIs that power modern web and mobile applications.",
    socialLinks: {
      github: "https://github.com/mohit",
      linkedin: "https://linkedin.com/in/mohit"
    },
    skills: ["Node.js", "Python", "MongoDB", "Microservices"],
    stats: {
      projects: "28+",
      experience: "2+ Years",
      passion: "100%"
    }
  },
  {
    id: 10,
    name: "Vishnu Kumar",
    role: "Frontend Developer",
    image: `${process.env.NEXT_PUBLIC_BACKEND_URL}/uploads/team/Vishnu-Kumar.png`,
    description: "Crafting responsive and interactive web interfaces with modern frameworks and best practices.",
    socialLinks: {
      github: "https://github.com/vishnu",
      linkedin: "https://linkedin.com/in/vishnu"
    },
    skills: ["React", "TypeScript", "CSS", "Performance"],
    stats: {
      projects: "32+",
      experience: "2+ Years",
      passion: "100%"
    }
  }
];

const socialIcons = {
  instagram: Instagram,
  twitter: Twitter,
  github: Github,
  linkedin: Linkedin
};

const socialColors = {
  instagram: "hover:bg-pink-500 hover:border-pink-500",
  twitter: "hover:bg-black hover:border-black",
  github: "hover:bg-gray-900 hover:border-gray-900",
  linkedin: "hover:bg-blue-600 hover:border-blue-600"
};

export default function MeetTeam() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [direction, setDirection] = useState(0);

  // Auto-slide functionality
  useEffect(() => {
    if (!isAutoPlaying) return;

    const interval = setInterval(() => {
      setDirection(1);
      setCurrentIndex((prev) => (prev + 1) % teamMembers.length);
    }, 5000); // Change every 5 seconds

    return () => clearInterval(interval);
  }, [isAutoPlaying]);

  const nextSlide = () => {
    setDirection(1);
    setCurrentIndex((prev) => (prev + 1) % teamMembers.length);
  };

  const prevSlide = () => {
    setDirection(-1);
    setCurrentIndex((prev) => (prev - 1 + teamMembers.length) % teamMembers.length);
  };

  const goToSlide = (index: number) => {
    setDirection(index > currentIndex ? 1 : -1);
    setCurrentIndex(index);
  };

  const toggleAutoPlay = () => {
    setIsAutoPlaying(!isAutoPlaying);
  };

  const currentMember = teamMembers[currentIndex];

  return (
    <section className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-6xl mx-auto w-full">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h1 className="text-5xl md:text-7xl font-bold mb-6 text-gray-900">
            Meet Our <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Team</span>
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Passionate developers, designers, and innovators building the future with cutting-edge technology
          </p>
        </motion.div>

        {/* Slider Container */}
        <div className="relative">
          {/* Navigation Arrows */}
          <button
            onClick={prevSlide}
            className="absolute left-4 top-1/2 transform -translate-y-1/2 z-20 bg-white/80 backdrop-blur-sm rounded-full p-3 shadow-2xl border border-gray-200 hover:bg-white transition-all duration-300 hover:scale-110"
          >
            <ChevronLeft className="h-6 w-6 text-gray-700" />
          </button>

          <button
            onClick={nextSlide}
            className="absolute right-4 top-1/2 transform -translate-y-1/2 z-20 bg-white/80 backdrop-blur-sm rounded-full p-3 shadow-2xl border border-gray-200 hover:bg-white transition-all duration-300 hover:scale-110"
          >
            <ChevronRight className="h-6 w-6 text-gray-700" />
          </button>

          {/* Auto-play Toggle */}
          <button
            onClick={toggleAutoPlay}
            className="absolute top-4 right-4 z-20 bg-white/80 backdrop-blur-sm rounded-full p-3 shadow-2xl border border-gray-200 hover:bg-white transition-all duration-300"
          >
            {isAutoPlaying ? (
              <Pause className="h-5 w-5 text-gray-700" />
            ) : (
              <Play className="h-5 w-5 text-gray-700" />
            )}
          </button>

          {/* Main Card */}
          <div className="relative h-[600px]">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={currentMember.id}
                custom={direction}
                initial={{ 
                  opacity: 0,
                  x: direction > 0 ? 300 : -300 
                }}
                animate={{ 
                  opacity: 1,
                  x: 0 
                }}
                exit={{ 
                  opacity: 0,
                  x: direction > 0 ? -300 : 300 
                }}
                transition={{ 
                  type: "spring", 
                  stiffness: 300, 
                  damping: 30 
                }}
                className="absolute inset-0"
              >
                <Card className="border-0 shadow-2xl overflow-hidden bg-white/80 backdrop-blur-sm h-full">
                  <div className="flex flex-col lg:flex-row items-center justify-between p-8 md:p-12 h-full">
                    {/* Image Section */}
                    <div className="flex-shrink-0 mb-8 lg:mb-0 lg:mr-12 relative group">
                      <div className="relative">
                        <motion.img
                          src={currentMember.image}
                          alt={currentMember.name}
                          className="w-72 h-72 object-cover rounded-2xl shadow-2xl group-hover:shadow-3xl transition-all duration-500 border-8 border-white"
                          whileHover={{ scale: 1.05 }}
                          transition={{ type: "spring", stiffness: 300 }}
                        />
                        {/* Gradient Overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-blue-600/10 to-purple-600/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                        
                        {/* Floating Elements */}
                        <motion.div
                          className="absolute -top-4 -right-4 bg-blue-600 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-lg"
                          initial={{ opacity: 0, scale: 0 }}
                          whileInView={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.5, type: "spring" }}
                        >
                          {currentMember.id}/10
                        </motion.div>
                      </div>
                    </div>

                    {/* Content Section */}
                    <div className="flex-1 text-center lg:text-left max-w-2xl">
                      {/* Name and Role */}
                      <div className="mb-6">
                        <motion.h2 
                          className="text-4xl md:text-5xl font-bold mb-4 text-gray-900"
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.2 }}
                        >
                          {currentMember.name.split(' ')[0]}{" "}
                          <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                            {currentMember.name.split(' ').slice(1).join(' ')}
                          </span>
                        </motion.h2>
                        
                        <motion.p 
                          className="text-lg text-blue-600 font-semibold mb-4"
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.3 }}
                        >
                          {currentMember.role}
                        </motion.p>
                        
                        <motion.p 
                          className="text-lg text-gray-600 mb-6 leading-relaxed"
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.4 }}
                        >
                          {currentMember.description}
                        </motion.p>
                      </div>

                      {/* Skills Grid */}
                      <motion.div 
                        className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                      >
                        {currentMember.skills.map((skill, index) => (
                          <motion.div
                            key={skill}
                            className="flex items-center justify-center lg:justify-start p-3 bg-white rounded-xl shadow-md border border-gray-100"
                            whileHover={{ scale: 1.05, y: -2 }}
                            transition={{ type: "spring", stiffness: 300 }}
                          >
                            <span className="text-sm font-medium text-gray-700 text-center">{skill}</span>
                          </motion.div>
                        ))}
                      </motion.div>

                      {/* Social Links */}
                      <motion.div 
                        className="flex flex-col sm:flex-row items-center justify-between gap-6"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6 }}
                      >
                        <div className="flex justify-center lg:justify-start space-x-3">
                          {Object.entries(currentMember.socialLinks).map(([platform, url]) => {
                            const IconComponent = socialIcons[platform as keyof typeof socialIcons];
                            const colorClass = socialColors[platform as keyof typeof socialColors];
                            return (
                              <motion.a
                                key={platform}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`group p-3 bg-white border-2 border-gray-200 rounded-xl shadow-md transition-all duration-300 hover:shadow-lg ${colorClass}`}
                                whileHover={{ scale: 1.1, y: -2 }}
                                whileTap={{ scale: 0.95 }}
                              >
                                <IconComponent className="h-5 w-5 text-gray-600 transition-colors duration-300 group-hover:text-white" />
                              </motion.a>
                            );
                          })}
                        </div>

                        {/* CTA Button */}
                        <Button 
                          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg transition-all duration-300 hover:scale-105 group"
                          asChild
                        >
                          <a href={currentMember.socialLinks.github || "#"} target="_blank" rel="noopener noreferrer">
                            View Profile
                            <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform duration-300" />
                          </a>
                        </Button>
                      </motion.div>

                      {/* Stats */}
                      <motion.div 
                        className="grid grid-cols-3 gap-6 mt-8 pt-8 border-t border-gray-200"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7 }}
                      >
                        {Object.entries(currentMember.stats).map(([key, value]) => (
                          <div key={key} className="text-center lg:text-left">
                            <div className="text-2xl font-bold text-gray-900 mb-1">{value}</div>
                            <div className="text-sm text-gray-600 capitalize">{key}</div>
                          </div>
                        ))}
                      </motion.div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Navigation Dots */}
          <div className="flex justify-center mt-8 space-x-3">
            {teamMembers.map((_, index) => (
              <button
                key={index}
                onClick={() => goToSlide(index)}
                className={`w-3 h-3 rounded-full transition-all duration-300 ${
                  index === currentIndex 
                    ? 'bg-blue-600 scale-125' 
                    : 'bg-gray-300 hover:bg-gray-400'
                }`}
              />
            ))}
          </div>

          {/* Team Counter */}
          <div className="text-center mt-6">
            <span className="text-gray-600">
              Showing {currentIndex + 1} of {teamMembers.length} team members
            </span>
          </div>
        </div>

        {/* Background Decorative Elements */}
        <div className="absolute top-1/4 left-10 w-4 h-4 bg-blue-600 rounded-full opacity-20 animate-pulse" />
        <div className="absolute bottom-1/4 right-10 w-6 h-6 bg-purple-600 rounded-full opacity-20 animate-pulse" />
        <div className="absolute top-1/2 left-1/4 w-3 h-3 bg-yellow-600 rounded-full opacity-20 animate-pulse" />
      </div>
    </section>
  );
}