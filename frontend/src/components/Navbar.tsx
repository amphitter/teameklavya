"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/components/lib/utlis";

export default function Navbar() {
  const [role, setRole] = useState<"admin" | "user" | null>(null);
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isAtTop, setIsAtTop] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const { theme, toggleTheme } = useTheme();

  const navbarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMounted(true);
    const storedRole = localStorage.getItem("role") as "admin" | "user" | null;
    setRole(storedRole);
  }, []);

  useEffect(() => {
    const controlNavbar = () => {
      const currentScrollY = window.scrollY;
      
      // Check if at top of page
      setIsAtTop(currentScrollY < 10);

      // Show/hide navbar based on scroll direction
      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        // Scrolling down and past 100px - hide navbar
        setIsVisible(false);
      } else {
        // Scrolling up - show navbar
        setIsVisible(true);
      }
      
      setLastScrollY(currentScrollY);
    };

    // Throttle the scroll event for better performance
    let ticking = false;
    const throttledControlNavbar = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          controlNavbar();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', throttledControlNavbar, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', throttledControlNavbar);
    };
  }, [lastScrollY]);

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
    if (typeof window !== "undefined") {
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
    if (typeof window !== "undefined") {
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

  if (!mounted) return null;

  const navLinks = getNavLinks();

  return (
    <nav
      ref={navbarRef}
      className={cn(
        "fixed top-0 left-0 right-0 z-50 w-full transition-all duration-500 ease-in-out",
        isVisible ? "translate-y-0" : "-translate-y-full",
        theme === "light" 
          ? isAtTop 
            ? "bg-white/80 border-b border-gray-200/50" 
            : "bg-white/95 backdrop-blur-md border-b border-gray-200/80 shadow-sm"
          : isAtTop
          ? "bg-slate-950/80 border-b border-slate-800/50"
          : "bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 shadow-lg shadow-black/10"
      )}
      style={{
        backdropFilter: isAtTop ? 'blur(0px)' : 'blur(12px)',
        WebkitBackdropFilter: isAtTop ? 'blur(0px)' : 'blur(12px)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className={cn(
                "flex items-center gap-2 font-bold text-xl hover:text-blue-600 transition-colors",
                theme === "light" ? "text-gray-900" : "text-white hover:text-blue-400"
              )}
            >
              <img
                src={theme === "dark" ? "/logo.png" : "/logo1.png"}
                alt="Team Eklavya"
                className="h-8 w-auto transition-transform duration-300 hover:scale-105"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
            </Link>

            {role && (
              <span
                className={cn(
                  "ml-4 px-3 py-1 rounded-full text-sm font-medium transition-colors duration-300",
                  role === "admin"
                    ? theme === "light"
                      ? "bg-red-100 text-red-700"
                      : "bg-red-900/30 text-red-300"
                    : theme === "light"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-blue-900/30 text-blue-300"
                )}
              >
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </span>
            )}
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1 ml-48">
            {navLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-100 hover:text-blue-600 transition-all duration-200 group relative",
                    theme === "light"
                      ? "text-gray-700"
                      : "text-gray-300 dark:hover:bg-slate-800 dark:hover:text-blue-400"
                  )}
                >
                  <Icon className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
                  {link.name}
                  <span className={cn(
                    "absolute bottom-0 left-0 w-0 h-0.5 bg-blue-600 transition-all duration-300 group-hover:w-full",
                    theme === "dark" && "bg-blue-400"
                  )} />
                </Link>
              );
            })}
          </div>

          {/* Desktop Right Section */}
          <div className="hidden md:flex items-center gap-3">
            {/* Theme Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className={cn(
                "hover:bg-gray-100 transition-all duration-300 hover:scale-110",
                theme === "light"
                  ? "text-gray-700 hover:bg-gray-200"
                  : "text-gray-300 hover:bg-slate-800"
              )}
            >
              {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </Button>

            {/* Auth Section */}
            {!role ? (
              <div className="flex items-center gap-3 ml-4 pl-4 border-l border-gray-200 dark:border-slate-800">
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className={cn(
                    "transition-all duration-300 hover:scale-105",
                    theme === "light" ? "text-gray-700 hover:text-blue-600" : "text-gray-300 hover:text-blue-400"
                  )}
                >
                  <Link href="/login">Login</Link>
                </Button>
                <Button
                  size="sm"
                  asChild
                  className="bg-blue-600 hover:bg-blue-700 text-white transition-all duration-300 hover:scale-105 shadow-lg hover:shadow-xl"
                >
                  <Link href="/signup">Sign Up</Link>
                </Button>
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "ml-4 pl-4 border-l border-gray-200 dark:border-slate-800 flex items-center gap-3 transition-all duration-300 hover:scale-105 group",
                      theme === "light" ? "text-gray-700 hover:bg-gray-100" : "text-gray-300 hover:bg-slate-800"
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-sm font-bold transition-transform duration-300 group-hover:scale-110 shadow-lg">
                      {getUserInitials()}
                    </div>
                    <div className="text-left">
                      <div className="font-medium text-sm">{getUserName()}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {role === "admin" ? "Administrator" : "Member"}
                      </div>
                    </div>
                    <ChevronDown className="h-4 w-4 opacity-50 transition-transform duration-300 group-hover:rotate-180" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent 
                  align="end" 
                  className={cn(
                    "w-56 transition-all duration-300",
                    theme === "dark" ? "bg-slate-900 border-slate-700" : "bg-white border-gray-200"
                  )}
                >
                  <DropdownMenuLabel className={theme === "dark" ? "text-gray-200" : ""}>
                    My Account
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className={theme === "dark" ? "bg-slate-700" : ""} />
                  <DropdownMenuItem asChild className={cn(
                    "cursor-pointer transition-colors duration-200",
                    theme === "dark" ? "hover:bg-slate-800 focus:bg-slate-800" : ""
                  )}>
                    <Link href="/user/profile">
                      <User className="h-4 w-4 mr-2" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  {role === "admin" && (
                    <DropdownMenuItem asChild className={cn(
                      "cursor-pointer transition-colors duration-200",
                      theme === "dark" ? "hover:bg-slate-800 focus:bg-slate-800" : ""
                    )}>
                      <Link href="/admin/dashboard">
                        <BarChart3 className="h-4 w-4 mr-2" />
                        Dashboard
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator className={theme === "dark" ? "bg-slate-700" : ""} />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className={cn(
                      "cursor-pointer transition-colors duration-200",
                      theme === "dark" 
                        ? "text-red-400 hover:bg-slate-800 hover:text-red-300 focus:bg-slate-800 focus:text-red-300" 
                        : "text-red-600 hover:bg-red-50 focus:bg-red-50"
                    )}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Mobile Menu */}
          <div className="md:hidden flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className={cn(
                "transition-all duration-300 hover:scale-110",
                theme === "light" ? "text-gray-700" : "text-gray-300 dark:hover:bg-slate-800"
              )}
            >
              {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </Button>

            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="transition-all duration-300 hover:scale-110"
                >
                  {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className={cn(
                  "w-80 transition-all duration-300 backdrop-blur-lg",
                  theme === "light" 
                    ? "bg-white/95 border-l border-gray-200/50 text-gray-900" 
                    : "bg-slate-950/95 border-l border-slate-800/50 text-gray-300"
                )}
                style={{
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                }}
              >
                {/* Mobile Header */}
                <div 
                  className="mb-6 pb-6 border-b" 
                  style={{ borderColor: theme === "light" ? "rgba(229, 231, 235, 0.5)" : "rgba(30, 41, 59, 0.5)" }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <img
                      src={theme === "dark" ? "/logo.png" : "/logo1.png"}
                      alt="Team Eklavya"
                      className="h-6 w-auto"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                  </div>
                  {role && (
                    <span
                      className={cn(
                        "inline-block px-3 py-1 rounded-full text-xs font-medium transition-colors duration-300",
                        role === "admin"
                          ? theme === "light"
                            ? "bg-red-100 text-red-700"
                            : "bg-red-900/30 text-red-300"
                          : theme === "light"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-blue-900/30 text-blue-300"
                      )}
                    >
                      {role === "admin" ? "Administrator" : "Member"}
                    </span>
                  )}
                </div>

                {/* Mobile Links */}
                <div className="space-y-2 mb-6">
                  {navLinks.map((link) => {
                    const Icon = link.icon;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium hover:text-blue-600 transition-all duration-200 group",
                          theme === "light"
                            ? "text-gray-700 hover:bg-gray-100/80"
                            : "text-gray-300 hover:bg-slate-800/80 dark:hover:text-blue-400"
                        )}
                      >
                        <Icon className="h-5 w-5 transition-transform duration-200 group-hover:scale-110" />
                        {link.name}
                      </Link>
                    );
                  })}
                </div>

                {/* Mobile Auth */}
                <div 
                  className="pt-6 border-t" 
                  style={{ borderColor: theme === "light" ? "rgba(229, 231, 235, 0.5)" : "rgba(30, 41, 59, 0.5)" }}
                >
                  {!role ? (
                    <div className="space-y-3">
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full border-gray-300 transition-all duration-300 hover:scale-105",
                          theme === "light" ? "text-gray-700" : "text-gray-300 dark:border-slate-700"
                        )}
                        asChild
                      >
                        <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
                          Login
                        </Link>
                      </Button>
                      <Button 
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white transition-all duration-300 hover:scale-105 shadow-lg" 
                        asChild
                      >
                        <Link href="/signup" onClick={() => setMobileMenuOpen(false)}>
                          Sign Up
                        </Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className={cn(
                        "px-4 py-3 rounded-lg transition-colors duration-300",
                        theme === "light" ? "bg-gray-50/80 text-gray-900" : "bg-slate-900/80 text-gray-300"
                      )}>
                        <div className="font-medium text-sm">{getUserName()}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {role === "admin" ? "Administrator" : "Member"}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full border-gray-300 transition-all duration-300 hover:scale-105",
                          theme === "light" ? "text-gray-700" : "text-gray-300 dark:border-slate-700"
                        )}
                        asChild
                      >
                        <Link href="/user/profile" onClick={() => setMobileMenuOpen(false)}>
                          <User className="h-4 w-4 mr-2" />
                          Profile
                        </Link>
                      </Button>
                      <Button
                        variant="destructive"
                        className="w-full transition-all duration-300 hover:scale-105"
                        onClick={() => {
                          handleLogout();
                          setMobileMenuOpen(false);
                        }}
                      >
                        <LogOut className="h-4 w-4 mr-2" />
                        Log out
                      </Button>
                    </div>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
}