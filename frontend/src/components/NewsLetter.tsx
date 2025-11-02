"use client";

import React from "react";
import Slider from "react-slick";
import {
  Award,
  Calendar,
  MapPin,
  Users,
  ArrowRight,
  Sparkles,
  Sun,
  Moon,
} from "lucide-react";
import Image from "next/image";
import { useTheme } from "@/context/ThemeContext";

type EventItem = {
  id: number;
  title: string;
  subtitle?: string;
  description?: string;
  image: string;
  gradientColors?: string;
  date?: string;
  location?: string;
  participants?: string;
  link?: string;
  badge?: string;
};

const NewsLetter: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  const events: EventItem[] = [
    {
      id: 1,
      title: "IIT Bombay Techfest 2025",
      subtitle: "Team Eklavya - Community Partner",
      description:
        "We had an amazing experience at the Delhi Zonals hosted at IIIT Delhi — witnessing brilliant innovations, powerful bots, and the energy of passionate young minds coming together.",
      image: "/iitb.jpg",
      gradientColors: "from-yellow-400 via-orange-500 to-red-500",
      date: "December 2024",
      location: "IIIT Delhi",
      participants: "500+",
      link: "https://techfest.org",
      badge: "Community Partnership",
    },

  ];

  const settings = {
    dots: true,
    infinite: true,
    autoplay: true,
    autoplaySpeed: 5500,
    speed: 700,
    slidesToShow: 1,
    slidesToScroll: 1,
    arrows: false,
    pauseOnHover: true,
  };

  return (
    <section
      className={`py-20 md:py-28 relative transition-colors duration-300 ${
        theme === "dark"
          ? "bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
          : "bg-gradient-to-br from-gray-50 via-white to-gray-50"
      }`}
    >
      {/* Background Blur */}
      <div className="absolute inset-0 overflow-hidden opacity-30 pointer-events-none">
        <div
          className={`absolute top-0 left-1/4 w-96 h-96 rounded-full blur-3xl ${
            theme === "dark" ? "bg-purple-600/20" : "bg-purple-400/30"
          } animate-pulse`}
        />
        <div
          className={`absolute bottom-0 right-1/4 w-96 h-96 rounded-full blur-3xl ${
            theme === "dark" ? "bg-blue-600/20" : "bg-blue-400/30"
          } animate-pulse`}
          style={{ animationDelay: "1s" }}
        />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
        {/* Header with toggle */}
        <div className="flex items-center justify-between mb-14 gap-4">
          <div>

            <h2
              className={`text-4xl sm:text-5xl font-bold mb-2 ${
                theme === "dark" ? "text-white" : "text-gray-900"
              }`}
            >
              Latest News & Highlights
            </h2>
            <p
              className={`text-lg max-w-2xl ${
                theme === "dark" ? "text-gray-400" : "text-gray-600"
              }`}
            >
              Stay connected with our journey — from campus events to national victories.
            </p>
          </div>

          
        </div>

        {/* Slider */}
        <Slider {...settings}>
          {events.map((event) => (
            <div key={event.id}>
              <div
                className={`grid md:grid-cols-2 items-center gap-10 p-6 md:p-10 rounded-3xl overflow-hidden backdrop-blur-sm border  ${
                  theme === "dark"
                    ? "bg-slate-800/40 border-slate-700/50"
                    : "bg-white border-gray-200"
                }`}
              >
                {/* Left: Image */}
                <div className="relative w-full h-80 md:h-[420px] overflow-hidden rounded-2xl">
                  {/* Use next/image with parent relative + fill */}
                  <Image
                    src={event.image}
                    alt={event.title}
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                    priority
                  />
                 
                </div>

                {/* Right: Content */}
                <div>
                  <div className="flex flex-wrap gap-4 mb-4 text-sm">
                    <span
                      className={`flex items-center gap-2 ${
                        theme === "dark" ? "text-gray-400" : "text-gray-600"
                      }`}
                    >
                      <Calendar className="h-4 w-4" /> {event.date}
                    </span>
                    <span
                      className={`flex items-center gap-2 ${
                        theme === "dark" ? "text-gray-400" : "text-gray-600"
                      }`}
                    >
                      <MapPin className="h-4 w-4" /> {event.location}
                    </span>
                    <span
                      className={`flex items-center gap-2 ${
                        theme === "dark" ? "text-gray-400" : "text-gray-600"
                      }`}
                    >
                      <Users className="h-4 w-4" /> {event.participants}
                    </span>
                  </div>

                  <h3
                    className={`text-3xl font-bold mb-2 bg-gradient-to-r ${event.gradientColors} bg-clip-text text-transparent`}
                  >
                    {event.title}
                  </h3>
                  <p
                    className={`text-lg font-medium mb-3 ${
                      theme === "dark" ? "text-gray-300" : "text-gray-700"
                    }`}
                  >
                    {event.subtitle}
                  </p>
                  <p
                    className={`text-base leading-relaxed mb-6 ${
                      theme === "dark" ? "text-gray-400" : "text-gray-600"
                    }`}
                  >
                    {event.description}
                  </p>

                  <a
                    href={event.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-2 px-6 py-3 rounded-full font-semibold transition-all duration-300 hover:gap-3 bg-gradient-to-r ${event.gradientColors} text-white shadow-md`}
                  >
                    <span>Learn More</span>
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </Slider>
      </div>
    </section>
  );
};

export default NewsLetter;
