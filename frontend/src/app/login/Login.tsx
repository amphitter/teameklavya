"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { jwtDecode } from "jwt-decode";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff, Mail, Lock, ArrowRight, Users, Shield, Sparkles, Zap } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { motion } from "framer-motion";

interface DecodedToken {
  id: string;
  role: string;
  exp: number;
}

export default function Login() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  
  const searchParams = useSearchParams();
  const router = useRouter();
  const { theme } = useTheme();

  // Get the return URL from query parameters or default to profile
  const returnUrl = searchParams.get('returnUrl') || '/user/profile';

  useEffect(() => {
    // Check if user is already logged in
    const token = localStorage.getItem("token");
    if (token) {
      router.push(returnUrl);
    }
  }, [returnUrl, router]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const res = await api.post("/auth/login", form);
      const token = res.data.token;

      if (!token) {
        setMessage("Login failed: Token not received.");
        return;
      }

      // Decode token to get role
      const decoded: DecodedToken = jwtDecode(token);
      const role = decoded.role.toLowerCase();

      localStorage.setItem("token", token);
      localStorage.setItem("role", role);

      // Redirect to the return URL or role-based default
      let redirectUrl = returnUrl;
      
      // If no specific return URL was provided, use role-based defaults
      if (returnUrl === '/user/profile') {
        if (role === "admin") {
          redirectUrl = "/admin/dashboard";
        } else if (role === "user") {
          redirectUrl = "/user/profile";
        }
      }

      // Use router.push for client-side navigation (no full page reload)
      router.push(redirectUrl);

    } catch (err: any) {
      console.error("Login error:", err);
      setMessage(err.response?.data?.message || "Login failed. Please check your credentials and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    // Include return URL in Google OAuth redirect
    const googleAuthUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/auth/google?returnUrl=${encodeURIComponent(returnUrl)}`;
    window.location.href = googleAuthUrl;
  };

  const logoUrl = theme === 'dark' ? '/logo.png' : '/logo1.png';

  return (
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
      
      {/* Enhanced gradient overlay for dark theme */}
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

      <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 relative z-10 py-12">
        {/* Header */}
        <motion.div 
          className="text-center mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Link href="/" className="inline-block mb-6">
            <motion.img 
              src={logoUrl}
              alt="Team Eklavya" 
              className="h-16 w-auto mx-auto -mb-10 drop-shadow-lg"
              whileHover={{ 
                scale: 1.05,
                rotateZ: 2,
                transition: { duration: 0.3 }
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).src = theme === 'dark' ? '/logo.png' : '/logo1.png';
              }}
            />
          </Link>
        </motion.div>

        {/* Login Card */}
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <Card className={`border-0 shadow-xl hover:shadow-2xl transition-all duration-500 ${
            theme === 'dark'
              ? 'bg-slate-800/30 backdrop-blur-sm'
              : 'bg-white'
          }`}>
            <CardHeader className="text-center pb-4">
              <CardTitle className={`text-2xl font-bold ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}>
                Sign In
              </CardTitle>
              <CardDescription className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
                Enter your credentials to access your account
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Login Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email Field */}
                <div className="space-y-2">
                  <label htmlFor="email" className={`text-sm font-medium ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-400'
                    }`} />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="Enter your email"
                      value={form.email}
                      onChange={handleChange}
                      required
                      className={`pl-10 h-12 transition-all duration-300 ${
                        theme === 'dark'
                          ? 'bg-slate-700/50 border-slate-600 focus:border-blue-500 text-white placeholder-gray-400'
                          : 'bg-white border-gray-300 focus:border-blue-500 text-gray-900'
                      }`}
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-2">
                  <label htmlFor="password" className={`text-sm font-medium ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    Password
                  </label>
                  <div className="relative">
                    <Lock className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-400'
                    }`} />
                    <Input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={form.password}
                      onChange={handleChange}
                      required
                      className={`pl-10 pr-10 h-12 transition-all duration-300 ${
                        theme === 'dark'
                          ? 'bg-slate-700/50 border-slate-600 focus:border-blue-500 text-white placeholder-gray-400'
                          : 'bg-white border-gray-300 focus:border-blue-500 text-gray-900'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className={`absolute right-3 top-1/2 transform -translate-y-1/2 transition-colors duration-300 ${
                        theme === 'dark' ? 'text-gray-400 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Forgot Password */}
                <div className="text-right">
                  <Link 
                    href="/auth/forgot-password" 
                    className="text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors duration-300"
                  >
                    Forgot your password?
                  </Link>
                </div>

                {/* Error Message */}
                {message && (
                  <motion.div 
                    className="p-3 rounded-lg border transition-all duration-300"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      backgroundColor: theme === 'dark' ? 'rgba(239, 68, 68, 0.1)' : '#fef2f2',
                      borderColor: theme === 'dark' ? 'rgba(239, 68, 68, 0.3)' : '#fecaca'
                    }}
                  >
                    <p className={`text-sm text-center ${
                      theme === 'dark' ? 'text-red-400' : 'text-red-600'
                    }`}>
                      {message}
                    </p>
                  </motion.div>
                )}

                {/* Submit Button */}
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-purple-600 hover:to-pink-600 text-white text-lg font-semibold transition-all duration-300 shadow-lg hover:shadow-xl border-0"
                  >
                    {loading ? (
                      <div className="flex items-center justify-center">
                        <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                        Signing In...
                      </div>
                    ) : (
                      <div className="flex items-center justify-center">
                        Sign In
                        <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                      </div>
                    )}
                  </Button>
                </motion.div>
              </form>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className={`w-full border-t ${
                    theme === 'dark' ? 'border-gray-700' : 'border-gray-300'
                  }`} />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className={`px-2 ${
                    theme === 'dark' 
                      ? 'bg-slate-900 text-gray-400' 
                      : 'bg-white text-gray-500'
                  }`}>
                    Or continue with
                  </span>
                </div>
              </div>

              {/* Google Login */}
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button
                  onClick={handleGoogleLogin}
                  variant="outline"
                  className={`w-full h-12 transition-all duration-300 backdrop-blur-sm ${
                    theme === 'dark'
                      ? 'bg-slate-700/50 border-slate-600 text-gray-300 hover:bg-slate-600 hover:border-slate-500'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400'
                  }`}
                >
                  <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </Button>
              </motion.div>
            </CardContent>

            <CardFooter className="flex flex-col space-y-4 pt-6">
              {/* Role Information */}
              <motion.div 
                className={`rounded-lg p-4 border transition-all duration-300 w-full ${
                  theme === 'dark'
                    ? 'bg-blue-500/10 border-blue-500/20'
                    : 'bg-blue-50 border-blue-200'
                }`}
                whileHover={{ scale: 1.02 }}
              >
                <div className="flex items-center justify-center space-x-6 text-sm">
                  <div className={`flex items-center space-x-2 ${
                    theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
                  }`}>
                    <Users className="h-4 w-4" />
                    <span>Member Access</span>
                  </div>
                  <div className={`flex items-center space-x-2 ${
                    theme === 'dark' ? 'text-red-400' : 'text-red-600'
                  }`}>
                    <Shield className="h-4 w-4" />
                    <span>Admin Access</span>
                  </div>
                </div>
              </motion.div>

              {/* Sign Up Link */}
              <div className={`text-center border-t w-full pt-6 ${
                theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
              }`}>
                <p className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>
                  Don't have an account?{" "}
                  <Link 
                    href="/signup" 
                    className="text-blue-400 hover:text-blue-300 font-semibold transition-colors duration-200"
                  >
                    Create an account
                  </Link>
                </p>
              </div>
            </CardFooter>
          </Card>
        </motion.div>

        {/* Additional Info */}
        <motion.div 
          className="text-center mt-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <p className={`text-sm ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-500'
          }`}>
            By signing in, you agree to our{" "}
            <Link href="/terms" className="text-blue-400 hover:text-blue-300 transition-colors duration-200">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-blue-400 hover:text-blue-300 transition-colors duration-200">
              Privacy Policy
            </Link>
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}