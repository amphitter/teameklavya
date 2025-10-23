"use client";
import { useState } from "react";
import Link from "next/link";
import { jwtDecode } from "jwt-decode";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff, Mail, Lock, ArrowRight, Users, Shield } from "lucide-react";

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

      // Redirect
      if (role === "admin") {
        window.location.href = "/admin/dashboard";
      } else if (role === "user") {
        window.location.href = "/user/profile";
      } else {
        setMessage("Unknown role. Contact admin.");
      }

    } catch (err: any) {
      console.error("Login error:", err);
      setMessage(err.response?.data?.message || "Login failed. Please check your credentials and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/auth/google`;
  };

  return (
    <div className="min-h-screen bg-white py-12">
      <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8 animate-fade-in-up">
          <Link href="/" className="inline-block mb-6">
            <img 
              src="/logo.png" 
              alt="Team Eklavya" 
              className="h-16 w-auto mx-auto"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/api/placeholder/64/64';
              }}
            />
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
            Welcome Back to{" "}
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Team Eklavya
            </span>
          </h1>
          <p className="text-gray-600 text-lg">
            Sign in to your account to continue
          </p>
        </div>

        {/* Login Card */}
        <Card className="border border-gray-200 shadow-sm animate-fade-in-up delay-100">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-bold text-gray-900">
              Sign In
            </CardTitle>
            <CardDescription className="text-gray-600">
              Enter your credentials to access your account
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email Field */}
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-gray-700">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="Enter your email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    className="pl-10 h-12 border-gray-300 focus:border-blue-500 bg-white"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-gray-700">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={form.password}
                    onChange={handleChange}
                    required
                    className="pl-10 pr-10 h-12 border-gray-300 focus:border-blue-500 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Forgot Password */}
              <div className="text-right">
                <Link 
                  href="/auth/forgot-password" 
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Forgot your password?
                </Link>
              </div>

              {/* Error Message */}
              {message && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600 text-center">{message}</p>
                </div>
              )}

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white text-lg font-semibold transition-all duration-300"
              >
                {loading ? (
                  <div className="flex items-center justify-center">
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Signing In...
                  </div>
                ) : (
                  <div className="flex items-center justify-center">
                    Sign In
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </div>
                )}
              </Button>
            </form>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Or continue with</span>
              </div>
            </div>

            {/* Google Login */}
            <Button
              onClick={handleGoogleLogin}
              variant="outline"
              className="w-full h-12 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all duration-300"
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
          </CardContent>

          <CardFooter className="flex flex-col space-y-4 pt-6">
            {/* Role Information */}
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <div className="flex items-center justify-center space-x-6 text-sm text-gray-600">
                <div className="flex items-center space-x-2">
                  <Users className="h-4 w-4 text-blue-600" />
                  <span>Member Access</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Shield className="h-4 w-4 text-red-600" />
                  <span>Admin Access</span>
                </div>
              </div>
            </div>

            {/* Sign Up Link */}
            <div className="text-center border-t border-gray-200 pt-6">
              <p className="text-gray-600">
                Don't have an account?{" "}
                <Link 
                  href="/auth/signup" 
                  className="text-blue-600 hover:text-blue-700 font-semibold transition-colors duration-200"
                >
                  Create an account
                </Link>
              </p>
            </div>
          </CardFooter>
        </Card>

        {/* Additional Info */}
        <div className="text-center mt-8 animate-fade-in-up delay-200">
          <p className="text-sm text-gray-500">
            By signing in, you agree to our{" "}
            <Link href="/terms" className="text-blue-600 hover:text-blue-700">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-blue-600 hover:text-blue-700">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}