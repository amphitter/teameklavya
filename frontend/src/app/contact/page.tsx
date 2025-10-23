"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { 
  Mail, 
  MessageCircle, 
  Send, 
  CheckCircle,
  Instagram, 
  Twitter, 
  Linkedin,
  ArrowRight
} from "lucide-react";
import { motion } from "framer-motion";

// Textarea component if not already in your UI components
const Textarea = ({ 
  className = "", 
  ...props 
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => {
  return (
    <textarea
      className={`flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50 resize-none ${className}`}
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

  const socialLinks = [
    {
      name: "Instagram",
      url: "https://www.instagram.com/iteameklavya",
      icon: Instagram,
      color: "hover:bg-pink-500 hover:border-pink-500"
    },
    {
      name: "Twitter",
      url: "https://x.com/iteameklavya",
      icon: Twitter,
      color: "hover:bg-black hover:border-black"
    },
    {
      name: "LinkedIn",
      url: "https://www.linkedin.com/company/i-team-eklavya",
      icon: Linkedin,
      color: "hover:bg-blue-600 hover:border-blue-600"
    },
    {
      name: "WhatsApp",
      url: "https://chat.whatsapp.com/L7HvHNOatFbHIWM7EGBaaA",
      icon: MessageCircle,
      color: "hover:bg-green-500 hover:border-green-500"
    }
  ];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });

    // Update character count for message field
    if (name === "message") {
      setCharacterCount(value.length);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Simulate form submission
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setIsSubmitting(false);
    setIsSubmitted(true);
    
    // Reset form after success
    setFormData({
      name: "",
      email: "",
      subject: "",
      message: ""
    });
    setCharacterCount(0);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header Section */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h1 className="text-5xl md:text-6xl font-bold mb-6 text-gray-900">
            Get In <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Touch</span>
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Have questions, ideas, or want to collaborate? We'd love to hear from you. 
            Reach out and let's build something amazing together.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-12 max-w-5xl mx-auto">
          {/* Contact Form */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Card className="border-0 shadow-2xl bg-white/80 backdrop-blur-sm">
              <CardHeader className="text-center pb-4">
                <CardTitle className="text-2xl font-bold text-gray-900">
                  Send us a Message
                </CardTitle>
                <CardDescription className="text-gray-600">
                  Fill out the form below and we'll get back to you as soon as possible.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isSubmitted ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center py-8"
                  >
                    <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">
                      Message Sent!
                    </h3>
                    <p className="text-gray-600 mb-6">
                      Thank you for reaching out. We'll get back to you within 24 hours.
                    </p>
                    <Button 
                      onClick={() => setIsSubmitted(false)}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      Send Another Message
                    </Button>
                  </motion.div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="name" className="text-gray-700 font-medium">
                          Full Name *
                        </Label>
                        <Input
                          id="name"
                          name="name"
                          type="text"
                          placeholder="Enter your full name"
                          value={formData.name}
                          onChange={handleChange}
                          required
                          className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-gray-700 font-medium">
                          Email Address *
                        </Label>
                        <Input
                          id="email"
                          name="email"
                          type="email"
                          placeholder="Enter your email address"
                          value={formData.email}
                          onChange={handleChange}
                          required
                          className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="subject" className="text-gray-700 font-medium">
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
                        className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <Label htmlFor="message" className="text-gray-700 font-medium">
                          Message *
                        </Label>
                        <span className={`text-sm ${characterCount > 500 ? 'text-red-500' : 'text-gray-500'}`}>
                          {characterCount}/500
                        </span>
                      </div>
                      <Textarea
                        id="message"
                        name="message"
                        placeholder="Tell us about your project, question, or idea... (Minimum 10 characters)"
                        rows={8}
                        value={formData.message}
                        onChange={handleChange}
                        required
                        minLength={10}
                        maxLength={500}
                        className="border-gray-300 focus:border-blue-500 focus:ring-blue-500 resize-vertical min-h-[120px]"
                      />
                      {formData.message.length < 10 && formData.message.length > 0 && (
                        <p className="text-red-500 text-sm">
                          Message must be at least 10 characters long
                        </p>
                      )}
                    </div>

                    <Button
                      type="submit"
                      disabled={isSubmitting || formData.message.length < 10}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 text-lg font-semibold transition-all duration-300 hover:scale-105 disabled:hover:scale-100 disabled:opacity-50"
                    >
                      {isSubmitting ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                          Sending...
                        </>
                      ) : (
                        <>
                          Send Message
                          <Send className="ml-2 h-5 w-5" />
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Contact Information */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="space-y-8"
          >
            {/* Email Card */}
            <Card className="border-0 shadow-2xl bg-white/80 backdrop-blur-sm">
              <CardHeader className="text-center pb-4">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4 mx-auto">
                  <Mail className="h-8 w-8 text-blue-600" />
                </div>
                <CardTitle className="text-xl font-bold text-gray-900">
                  Email Us
                </CardTitle>
                <CardDescription className="text-gray-600">
                  Send us an email anytime
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <a
                  href="mailto:teameklavya4info@gmail.com"
                  className="inline-flex items-center text-xl font-bold text-blue-600 hover:text-blue-700 transition-colors duration-300 break-all mb-4"
                >
                  <Mail className="h-5 w-5 mr-2" />
                  teameklavya4info@gmail.com
                </a>
                <p className="text-gray-600 mt-4 text-sm">
                  We typically respond within 24 hours. For urgent matters, please mention "URGENT" in your subject line.
                </p>
              </CardContent>
            </Card>

            {/* Response Time Card */}
            <Card className="border-0 shadow-2xl bg-gradient-to-br from-blue-600 to-purple-600 text-white">
              <CardHeader className="text-center pb-4">
                <CardTitle className="text-xl font-bold">
                  Quick Response
                </CardTitle>
              </CardHeader>
              <CardContent className="text-center">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-blue-100">Initial Response</span>
                    <span className="font-semibold">Within 24 hours</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-blue-100">Detailed Response</span>
                    <span className="font-semibold">1-2 business days</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-blue-100">Urgent Matters</span>
                    <span className="font-semibold">Mark as "URGENT"</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Social Links Card */}
            <Card className="border-0 shadow-2xl bg-white/80 backdrop-blur-sm">
              <CardHeader className="text-center pb-4">
                <CardTitle className="text-xl font-bold text-gray-900">
                  Connect With Us
                </CardTitle>
                <CardDescription className="text-gray-600">
                  Follow us on social media for updates
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  {socialLinks.map((social) => (
                    <motion.a
                      key={social.name}
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-center p-4 bg-white border-2 border-gray-200 rounded-xl shadow-md transition-all duration-300 hover:shadow-lg ${social.color} group`}
                      whileHover={{ scale: 1.05, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <div className="text-center">
                        <social.icon className="h-6 w-6 text-gray-600 transition-colors duration-300 group-hover:text-white mx-auto mb-2" />
                        <span className="text-sm font-medium text-gray-700 transition-colors duration-300 group-hover:text-white">
                          {social.name}
                        </span>
                      </div>
                    </motion.a>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Quick Links Card */}
            <Card className="border-0 shadow-2xl bg-white/80 backdrop-blur-sm">
              <CardHeader className="text-center pb-4">
                <CardTitle className="text-xl font-bold text-gray-900">
                  Quick Links
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <Button 
                    variant="outline" 
                    className="w-full justify-between border-blue-600 text-blue-600 hover:bg-blue-50"
                    asChild
                  >
                    <Link href="/events">
                      Explore Events
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-full justify-between border-purple-600 text-purple-600 hover:bg-purple-50"
                    asChild
                  >
                    <Link href="/about">
                      About Team Eklavya
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-full justify-between border-green-600 text-green-600 hover:bg-green-50"
                    asChild
                  >
                    <Link href="/signup">
                      Join Our Community
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* FAQ Section */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="max-w-4xl mx-auto mt-20"
        >
          <Card className="border-0 shadow-2xl bg-white/80 backdrop-blur-sm">
            <CardHeader className="text-center">
              <CardTitle className="text-3xl font-bold text-gray-900">
                Frequently Asked Questions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <h4 className="font-semibold text-gray-900 text-lg">
                  How quickly can I expect a response?
                </h4>
                <p className="text-gray-600">
                  We typically respond to all emails within 24 hours. For urgent matters, please include "URGENT" in your subject line.
                </p>
              </div>
              
              <div className="space-y-2">
                <h4 className="font-semibold text-gray-900 text-lg">
                  Can I collaborate with Team Eklavya?
                </h4>
                <p className="text-gray-600">
                  Absolutely! We're always open to collaborations with other communities, organizations, and industry partners. Tell us about your idea in the message.
                </p>
              </div>
              
              <div className="space-y-2">
                <h4 className="font-semibold text-gray-900 text-lg">
                  How can I join Team Eklavya?
                </h4>
                <p className="text-gray-600">
                  You can join our community by signing up on our website and participating in our events and activities. Use the quick links above to get started.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-gray-900 text-lg">
                  What should I include in my message?
                </h4>
                <p className="text-gray-600">
                  Please include your name, contact information, and a clear description of your inquiry, project idea, or collaboration proposal. The more details you provide, the better we can assist you.
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* CTA Section */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="text-center mt-16"
        >
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-3xl p-12 text-white shadow-2xl">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Ready to Start Your Journey?
            </h2>
            <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
              Join our community of innovators and creators. Let's build something amazing together.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button 
                size="lg" 
                variant="secondary"
                className="bg-white text-blue-600 hover:bg-gray-100 px-8 py-3 text-lg font-semibold border-0"
                asChild
              >
                <Link href="/signup">
                  Join Now
                </Link>
              </Button>
              <Button 
                size="lg"
                variant="outline" 
                className="border-white text-white hover:bg-white/10 px-8 py-3 text-lg font-semibold"
                asChild
              >
                <Link href="/events">
                  Explore Events
                </Link>
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}