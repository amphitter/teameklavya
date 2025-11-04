"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { 
  Mail, 
  MessageCircle, 
  Send, 
  CheckCircle,
  Instagram, 
  Twitter, 
  Linkedin,
  User,
  AlertCircle,
  MapPin,
  Clock,
  Zap,
  Sun,
  Moon
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Theme Toggle Component
const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <motion.button
      onClick={toggleTheme}
      className={`p-3 rounded-full backdrop-blur-sm transition-all duration-300 shadow-lg ${
        theme === 'dark'
          ? 'bg-slate-800/70 text-gray-300 hover:bg-slate-700'
          : 'bg-white/80 text-gray-700 hover:bg-white'
      }`}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9 }}
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </motion.button>
  );
};

// Textarea component
const Textarea = ({ 
  className = "", 
  ...props 
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => {
  const { theme } = useTheme();
  
  return (
    <textarea
      className={`flex min-h-[120px] w-full rounded-2xl border px-6 py-4 text-base placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50 resize-none transition-all duration-300 ${
        theme === 'dark'
          ? 'bg-slate-800/30 border-slate-600 text-white backdrop-blur-sm'
          : 'bg-white border-gray-200 text-gray-900'
      } ${className}`}
      {...props}
    />
  );
};

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [characterCount, setCharacterCount] = useState(0);
  const [error, setError] = useState("");
  const { theme } = useTheme();

  const contactMethods = [
    {
      icon: Mail,
      title: "Email Us",
      description: "Send us an email anytime",
      value: "eklavya4bussiness@gmail.com",
      link: "mailto:eklavya4bussiness@gmail.com",
      color: "from-blue-500 to-cyan-500"
    },
    {
      icon: MessageCircle,
      title: "WhatsApp",
      description: "Chat with us directly",
      value: "Join our group",
      link: "https://chat.whatsapp.com/L7HvHNOatFbHIWM7EGBaaA",
      color: "from-green-500 to-emerald-500"
    },
    {
      icon: MapPin,
      title: "Location",
      description: "Based in India",
      value: "Remote & In-person",
      link: "#",
      color: "from-purple-500 to-pink-500"
    },
    {
      icon: Clock,
      title: "Response Time",
      description: "We're quick to respond",
      value: "Within 24 hours",
      link: "#",
      color: "from-orange-500 to-red-500"
    }
  ];

  const socialLinks = [
    {
      name: "Instagram",
      url: "https://www.instagram.com/iteameklavya",
      icon: Instagram,
      color: "hover:bg-gradient-to-br from-purple-500 to-pink-500"
    },
    {
      name: "Twitter",
      url: "https://x.com/iteameklavya",
      icon: Twitter,
      color: "hover:bg-gradient-to-br from-blue-400 to-cyan-500"
    },
    {
      name: "LinkedIn",
      url: "https://www.linkedin.com/company/i-team-eklavya",
      icon: Linkedin,
      color: "hover:bg-gradient-to-br from-blue-600 to-blue-800"
    }
  ];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });

    if (error) setError("");
    if (name === "message") setCharacterCount(value.length);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");

    if (formData.message.length < 10) {
      setError("Message must be at least 10 characters long");
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'eklavya4bussiness@gmail.com',
          subject: `Contact Form: ${formData.subject}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                <h1 style="margin: 0; font-size: 24px;">New Contact Form Submission</h1>
                <p style="margin: 10px 0 0 0; opacity: 0.9;">Team Eklavya Website</p>
              </div>
              <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
                <div style="margin-bottom: 15px; padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #2563eb;">
                  <div style="font-weight: bold; color: #2563eb; margin-bottom: 5px;">From</div>
                  <div>${formData.name} (${formData.email})</div>
                </div>
                <div style="margin-bottom: 15px; padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #2563eb;">
                  <div style="font-weight: bold; color: #2563eb; margin-bottom: 5px;">Subject</div>
                  <div>${formData.subject}</div>
                </div>
                <div style="margin-bottom: 15px; padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #2563eb;">
                  <div style="font-weight: bold; color: #2563eb; margin-bottom: 5px;">Message</div>
                  <div style="white-space: pre-wrap;">${formData.message}</div>
                </div>
              </div>
            </div>
          `,
          text: `
New Contact Form Submission - Team Eklavya
From: ${formData.name} (${formData.email})
Subject: ${formData.subject}
Message: ${formData.message}
Submitted: ${new Date().toLocaleString()}
          `.trim()
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP error! status: ${response.status}`);

      if (data.success) {
        setIsSubmitted(true);
        setFormData({ name: "", email: "", subject: "", message: "" });
        setCharacterCount(0);
      } else {
        throw new Error(data.error || 'Failed to send message');
      }
    } catch (err) {
      console.error('Error sending message:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message. Please try again.';
      if (errorMessage.includes('Unexpected token') || errorMessage.includes('JSON')) {
        setError('Contact service is currently unavailable. Please email us directly.');
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = formData.name && formData.email && formData.subject && formData.message.length >= 10;

  return (
    <div className={`min-h-screen transition-colors duration-300 ${
      theme === 'dark'
        ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white'
        : 'bg-white text-gray-900'
    }`}>


      {/* Header Section */}
      <section className={`relative py-16 md:py-24 overflow-hidden transition-colors duration-300 ${
        theme === 'dark' ? 'bg-transparent' : 'bg-gradient-to-br from-blue-50 to-purple-50'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-3xl mx-auto"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className={`inline-flex items-center gap-3 px-6 py-3 rounded-2xl mb-8 font-medium shadow-lg border transition-colors duration-300 ${
                theme === 'dark'
                  ? 'bg-slate-800/60 text-blue-400 border-blue-500/20 backdrop-blur-sm'
                  : 'bg-white text-blue-600 border-blue-100'
              }`}
            >
              <MessageCircle className="h-5 w-5" />
              <span className="text-sm font-semibold">Get In Touch</span>
            </motion.div>
            
            <h1 className={`text-5xl sm:text-6xl md:text-7xl font-bold mb-8 transition-colors duration-300 ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}>
              Let's <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">Talk</span>
            </h1>
            
            <p className={`text-xl mb-12 leading-relaxed max-w-2xl mx-auto transition-colors duration-300 ${
              theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
            }`}>
              Ready to bring your ideas to life? We're here to help. Get in touch and let's create something amazing together.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Main Content */}
      <section className={`py-20 transition-colors duration-300 ${
        theme === 'dark' ? 'bg-transparent' : 'bg-white'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20">
            {/* Contact Information */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="space-y-8"
            >
              {/* Contact Methods Grid */}
              <div className="grid sm:grid-cols-2 gap-6">
                {contactMethods.map((method, index) => (
                  <motion.div
                    key={method.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 + index * 0.1 }}
                  >
                    <Card className={`shadow-lg rounded-2xl hover:shadow-xl transition-all duration-300 group hover:scale-105 ${
                      theme === 'dark'
                        ? 'bg-slate-800/30 border-slate-700 backdrop-blur-sm'
                        : 'bg-white border-gray-200'
                    }`}>
                      <CardContent className="p-6 text-center">
                        <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br ${method.color} mb-4 group-hover:scale-110 transition-transform duration-300`}>
                          <method.icon className="h-7 w-7 text-white" />
                        </div>
                        <h3 className={`font-bold text-lg mb-2 transition-colors duration-300 ${
                          theme === 'dark' ? 'text-white' : 'text-gray-900'
                        }`}>{method.title}</h3>
                        <p className={`text-sm mb-3 transition-colors duration-300 ${
                          theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                        }`}>{method.description}</p>
                        {method.link !== "#" ? (
                          <a
                            href={method.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 font-medium text-sm transition-colors"
                          >
                            {method.value}
                          </a>
                        ) : (
                          <span className={`font-medium text-sm transition-colors duration-300 ${
                            theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                          }`}>{method.value}</span>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>

              {/* Social Links */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.6 }}
              >
                <Card className={`shadow-lg rounded-2xl ${
                  theme === 'dark'
                    ? 'bg-slate-800/30 border-slate-700 backdrop-blur-sm'
                    : 'bg-white border-gray-200'
                }`}>
                  <CardHeader className="text-center pb-4">
                    <CardTitle className={`text-xl font-bold transition-colors duration-300 ${
                      theme === 'dark' ? 'text-white' : 'text-gray-900'
                    }`}>
                      Follow Our Journey
                    </CardTitle>
                    <CardDescription className={`transition-colors duration-300 ${
                      theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                    }`}>
                      Stay updated with our latest projects and events
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-center gap-4">
                      {socialLinks.map((social) => (
                        <motion.a
                          key={social.name}
                          href={social.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center justify-center w-14 h-14 rounded-2xl border shadow-sm transition-all duration-300 ${social.color} hover:shadow-lg hover:scale-110 ${
                            theme === 'dark'
                              ? 'bg-slate-800/60 border-slate-600'
                              : 'bg-white border-gray-200'
                          }`}
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          <social.icon className={`h-6 w-6 transition-colors duration-300 ${
                            theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                          }`} />
                        </motion.a>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Quick Response Note */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.7 }}
                className="bg-gradient-to-r from-blue-500 to-purple-500 rounded-2xl p-6 text-white text-center"
              >
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Zap className="h-5 w-5" />
                  <span className="font-semibold">Quick Response</span>
                </div>
                <p className="text-blue-100 text-sm">
                  We typically reply within 24 hours. For urgent matters, mention "URGENT" in your message.
                </p>
              </motion.div>
            </motion.div>

            {/* Contact Form */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
            >
              <Card className={`shadow-2xl rounded-3xl overflow-hidden ${
                theme === 'dark'
                  ? 'bg-slate-800/30 border-slate-700 backdrop-blur-sm'
                  : 'bg-white border-gray-200'
              }`}>
                <CardHeader className={`text-center pb-6 ${
                  theme === 'dark'
                    ? 'bg-gradient-to-r from-blue-500/10 to-purple-500/10'
                    : 'bg-gradient-to-r from-blue-50 to-purple-50'
                }`}>
                  <CardTitle className={`text-3xl font-bold transition-colors duration-300 ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}>
                    Send Message
                  </CardTitle>
                  <CardDescription className={`text-lg transition-colors duration-300 ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                  }`}>
                    Fill out the form and we'll get back to you soon
                  </CardDescription>
                </CardHeader>
                
                <CardContent className="pt-8">
                  <AnimatePresence mode="wait">
                    {isSubmitted ? (
                      <motion.div
                        key="success"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="text-center py-12"
                      >
                        <div className="inline-flex items-center justify-center w-24 h-24 bg-green-100 rounded-full mb-6 mx-auto">
                          <CheckCircle className="h-12 w-12 text-green-600" />
                        </div>
                        <h3 className={`text-2xl font-bold mb-4 transition-colors duration-300 ${
                          theme === 'dark' ? 'text-white' : 'text-gray-900'
                        }`}>
                          Message Sent!
                        </h3>
                        <p className={`mb-8 leading-relaxed transition-colors duration-300 ${
                          theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                        }`}>
                          Thank you for reaching out. We've received your message and will get back to you within 24 hours.
                        </p>
                        <Button 
                          onClick={() => setIsSubmitted(false)}
                          className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-purple-500 hover:to-pink-500 text-white rounded-2xl px-8 py-3 text-base font-semibold transition-all duration-300 hover:scale-105 hover:shadow-lg"
                        >
                          Send Another Message
                        </Button>
                      </motion.div>
                    ) : (
                      <motion.form
                        key="form"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onSubmit={handleSubmit}
                        className="space-y-6"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                          <div className="space-y-4">
                            <Label htmlFor="name" className={`font-medium text-sm transition-colors duration-300 ${
                              theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                              Full Name *
                            </Label>
                            <div className="relative">
                              <User className={`absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-400'
                              }`} />
                              <Input
                                id="name"
                                name="name"
                                type="text"
                                placeholder="Your full name"
                                value={formData.name}
                                onChange={handleChange}
                                required
                                className={`pl-12 focus:border-blue-500 focus:ring-blue-500 rounded-2xl h-14 transition-all duration-300 ${
                                  theme === 'dark'
                                    ? 'bg-slate-800/30 border-slate-600 text-white placeholder-gray-400 backdrop-blur-sm'
                                    : 'bg-white border-gray-200 text-gray-900'
                                }`}
                              />
                            </div>
                          </div>

                          <div className="space-y-4">
                            <Label htmlFor="email" className={`font-medium text-sm transition-colors duration-300 ${
                              theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                              Email Address *
                            </Label>
                            <div className="relative">
                              <Mail className={`absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-400'
                              }`} />
                              <Input
                                id="email"
                                name="email"
                                type="email"
                                placeholder="your.email@example.com"
                                value={formData.email}
                                onChange={handleChange}
                                required
                                className={`pl-12 focus:border-blue-500 focus:ring-blue-500 rounded-2xl h-14 transition-all duration-300 ${
                                  theme === 'dark'
                                    ? 'bg-slate-800/30 border-slate-600 text-white placeholder-gray-400 backdrop-blur-sm'
                                    : 'bg-white border-gray-200 text-gray-900'
                                }`}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <Label htmlFor="subject" className={`font-medium text-sm transition-colors duration-300 ${
                            theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                          }`}>
                            Subject *
                          </Label>
                          <Input
                            id="subject"
                            name="subject"
                            type="text"
                            placeholder="What's this about?"
                            value={formData.subject}
                            onChange={handleChange}
                            required
                            className={`focus:border-blue-500 focus:ring-blue-500 rounded-2xl h-14 transition-all duration-300 ${
                              theme === 'dark'
                                ? 'bg-slate-800/30 border-slate-600 text-white placeholder-gray-400 backdrop-blur-sm'
                                : 'bg-white border-gray-200 text-gray-900'
                            }`}
                          />
                        </div>

                        <div className="space-y-4">
                          <div className="flex justify-between items-center">
                            <Label htmlFor="message" className={`font-medium text-sm transition-colors duration-300 ${
                              theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                              Message *
                            </Label>
                            <span className={`text-sm ${
                              characterCount > 500 ? 'text-red-500' : theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                            }`}>
                              {characterCount}/500
                            </span>
                          </div>
                          <Textarea
                            id="message"
                            name="message"
                            placeholder="Tell us about your project, question, or idea... (Minimum 10 characters)"
                            value={formData.message}
                            onChange={handleChange}
                            required
                            minLength={10}
                            maxLength={500}
                          />
                          {formData.message.length < 10 && formData.message.length > 0 && (
                            <p className="text-red-500 text-sm flex items-center gap-2">
                              <AlertCircle className="h-4 w-4" />
                              Message must be at least 10 characters long
                            </p>
                          )}
                        </div>

                        {error && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`flex items-center gap-3 p-4 rounded-2xl text-red-700 ${
                              theme === 'dark' 
                                ? 'bg-red-500/10 border border-red-500/20' 
                                : 'bg-red-50 border border-red-200'
                            }`}
                          >
                            <AlertCircle className="h-5 w-5 flex-shrink-0" />
                            <p className="text-sm">{error}</p>
                          </motion.div>
                        )}

                        <Button
                          type="submit"
                          disabled={isSubmitting || !isFormValid}
                          className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-purple-500 hover:to-pink-500 text-white py-4 text-base font-semibold transition-all duration-300 hover:scale-[1.02] disabled:hover:scale-100 disabled:opacity-50 rounded-2xl shadow-lg hover:shadow-xl"
                        >
                          {isSubmitting ? (
                            <div className="flex items-center justify-center gap-3">
                              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                              Sending Message...
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-3">
                              Send Message
                              <Send className="h-5 w-5" />
                            </div>
                          )}
                        </Button>
                      </motion.form>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}