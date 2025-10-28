"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { 
  Sun, 
  Moon, 
  Menu, 
  X,
  User,
  LogOut,
  ChevronDown,
  Calendar,
  Home,
  Users,
  FileText,
  BarChart3,
  Shield
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";

export default function Navbar() {
  const [role, setRole] = useState<"admin" | "user" | null>(null);
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
    const storedRole = localStorage.getItem("role") as "admin" | "user" | null;
    setRole(storedRole);
  }, []);

  // Navigation links based on role
  const getNavLinks = () => {
    if (role === "admin") {
      return [
        { name: "Dashboard", href: "/admin/dashboard", icon: BarChart3 },
        { name: "Events", href: "/admin/events", icon: Calendar },
        { name: "Users", href: "/admin/users", icon: Users },
        { name: "Registrations", href: "/admin/registrations", icon: FileText },
      ];
    } else if (role === "user") {
      return [
        { name: "Home", href: "/", icon: Home },
        { name: "Events", href: "/events", icon: Calendar },
        { name: "My Registrations", href: "/user/registrations", icon: FileText },
        { name: "My Profile", href: "/user/profile", icon: User },
      ];
    } else {
      return [
        { name: "Home", href: "/", icon: Home },
        { name: "Events", href: "/events", icon: Calendar },
        { name: "About", href: "/about", icon: Users },
        { name: "Contact", href: "/contact", icon: FileText },
      ];
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("user");
    window.location.href = "/";
  };

  const getUserInitials = () => {
    if (typeof window !== 'undefined') {
      const userData = localStorage.getItem("user");
      if (userData) {
        try {
          const user = JSON.parse(userData);
          if (user.firstName && user.lastName) {
            return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
          }
          if (user.email) {
            return user.email.charAt(0).toUpperCase();
          }
        } catch (e) {
          console.error("Error parsing user data:", e);
        }
      }
    }
    return "U";
  };

  const getUserName = () => {
    if (typeof window !== 'undefined') {
      const userData = localStorage.getItem("user");
      if (userData) {
        try {
          const user = JSON.parse(userData);
          if (user.firstName && user.lastName) {
            return `${user.firstName} ${user.lastName}`;
          }
          return user.email || "User";
        } catch (e) {
          console.error("Error parsing user data:", e);
        }
      }
    }
    return "User";
  };

  if (!mounted) {
    return (
      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Loading skeleton */}
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 bg-gray-300 rounded animate-pulse"></div>
              <div className="h-6 w-32 bg-gray-300 rounded animate-pulse"></div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="h-9 w-9 bg-gray-300 rounded animate-pulse"></div>
              <div className="h-9 w-9 bg-gray-300 rounded animate-pulse"></div>
            </div>
          </div>
        </div>
      </nav>
    );
  }

  const navLinks = getNavLinks();

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo and Brand */}
          <div className="flex items-center space-x-3">
            <Link href="/" className="flex items-center space-x-3 group">
              <img 
                src="/logo1.png" 
                alt="Team Eklavya" 
                className="h-10 w-auto transition-transform group-hover:scale-105"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/api/placeholder/40/40';
                }}
              />

            </Link>

            {/* Role Badge */}
            {role && (
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                role === "admin" 
                  ? "bg-red-100 text-red-800" 
                  : "bg-blue-100 text-blue-800"
              }`}>
                {role === "admin" && <Shield className="w-3 h-3 mr-1" />}
                {role?.charAt(0).toUpperCase() + role?.slice(1)}
              </span>
            )}
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-1">
            {/* Navigation Links */}
            <div className="flex items-center space-x-1 mr-4">
              {navLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center space-x-1 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-100 transition-all duration-200"
                  >
                    <Icon className="h-4 w-4" />
                    <span>{link.name}</span>
                  </Link>
                );
              })}
            </div>

            {/* Theme Toggle */}

            {/* Auth Section */}
            {!role ? (
              <div className="flex items-center space-x-2 ml-2">
                <Button variant="ghost" asChild className="rounded-lg text-gray-700">
                  <Link href="/login">Login</Link>
                </Button>
                <Button asChild className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
                  <Link href="/signup">Sign Up</Link>
                </Button>
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild >
                  <Button variant="ghost" className="relative h-9 w-9 rounded-full ml-2">
                    <div className="flex items-center space-x-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-purple-600 text-white text-sm font-medium">
                        {getUserInitials()}
                      </div>
                      <ChevronDown className="h-4 w-4 text-gray-600" />
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 text-blue-700" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{getUserName()}</p>
                      <p className="text-xs leading-none text-gray-500">
                        {role === "admin" ? "Administrator" : "Member"}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/user/profile" className="cursor-pointer">
                      <User className="mr-2 h-4 w-4" />
                      <span>Profile</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={handleLogout}
                    className="cursor-pointer text-red-600 focus:text-red-600"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="flex md:hidden items-center space-x-2">

            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-lg">
                  {mobileMenuOpen ? (
                    <X className="h-6 w-6" />
                  ) : (
                    <Menu className="h-6 w-6" />
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[300px] sm:w-[400px] bg-white">
                <div className="flex flex-col h-full">
                  {/* Mobile Navigation Header */}
                  <div className="flex items-center space-x-3 pb-6 border-b border-gray-200">
                    <img 
                      src="/logo.png" 
                      alt="Team Eklavya" 
                      className="h-10 w-auto"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/logo.png';
                      }}
                    />
                    <div>
                      <span className="text-lg font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                        Team Eklavya
                      </span>
                      {role && (
                        <div className="text-xs text-gray-500">
                          {role === "admin" ? "Administrator" : "Member"}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Mobile Navigation Links */}
                  <nav className="flex-1 py-6">
                    <div className="space-y-2">
                      {navLinks.map((link) => {
                        const Icon = link.icon;
                        return (
                          <Link
                            key={link.href}
                            href={link.href}
                            onClick={() => setMobileMenuOpen(false)}
                            className="flex items-center space-x-3 px-3 py-3 rounded-lg text-base font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-100 transition-all duration-200"
                          >
                            <Icon className="h-5 w-5" />
                            <span>{link.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </nav>

                  {/* Mobile Auth Section */}
                  <div className="border-t border-gray-200 pt-6 space-y-4">
                    {!role ? (
                      <div className="space-y-3">
                        <Button asChild className="w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
                          <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
                            Login
                          </Link>
                        </Button>
                        <Button asChild variant="outline" className="w-full rounded-lg">
                          <Link href="/signup" onClick={() => setMobileMenuOpen(false)}>
                            Sign Up
                          </Link>
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center space-x-3 px-3 py-2">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-purple-600 text-white text-sm font-medium">
                            {getUserInitials()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {getUserName()}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {role === "admin" ? "Administrator" : "Member"}
                            </p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Button 
                            variant="outline" 
                            asChild
                            className="w-full rounded-lg justify-start"
                          >
                            <Link href="/user/profile" onClick={() => setMobileMenuOpen(false)}>
                              <User className="mr-2 h-4 w-4" />
                              Profile
                            </Link>
                          </Button>
                          <Button 
                            variant="destructive" 
                            onClick={handleLogout}
                            className="w-full rounded-lg justify-start"
                          >
                            <LogOut className="mr-2 h-4 w-4" />
                            Log out
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
}