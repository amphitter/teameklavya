"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, ArrowLeft, CheckCircle, Eye, EyeOff, Lock, AlertCircle } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [step, setStep] = useState<"request" | "verify" | "reset">("request");
  const [otp, setOtp] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Countdown timer for OTP resend
  const startCountdown = () => {
    setCountdown(60);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      console.log("📧 Requesting password reset for:", email);
      const res = await api.post("/auth/password/forgot", { email });
      console.log("✅ Reset request response:", res.data);
      
      setMessage("Verification code sent to your email. Please check your inbox.");
      setIsSuccess(true);
      setStep("verify");
      startCountdown();
    } catch (err: any) {
      console.error("❌ Reset request error:", err);
      const errorMessage = err.response?.data?.message || 
                          "Unable to send verification code. Please try again.";
      setMessage(errorMessage);
      setIsSuccess(false);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      console.log("🔐 Verifying OTP:", { email, otp: otp.trim() });
      const res = await api.post("/auth/password/verify-otp", { 
        email, 
        otp: otp.trim() 
      });
      console.log("✅ OTP verification response:", res.data);
      
      if (!res.data.tempToken) {
        throw new Error("No temporary token received from server");
      }
      
      setTempToken(res.data.tempToken);
      setMessage("Code verified successfully! You can now set your new password.");
      setIsSuccess(true);
      setStep("reset");
    } catch (err: any) {
      console.error("❌ OTP verification error:", err);
      const errorMessage = err.response?.data?.message || 
                          "Invalid verification code. Please check and try again.";
      setMessage(errorMessage);
      setIsSuccess(false);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    // Frontend validation
    if (newPassword !== confirmPassword) {
      setMessage("Passwords do not match. Please check and try again.");
      setIsSuccess(false);
      setLoading(false);
      return;
    }

    if (newPassword.length < 8) {
      setMessage("Password must be at least 8 characters long.");
      setIsSuccess(false);
      setLoading(false);
      return;
    }

    try {
      console.log("🔄 Resetting password:", { 
        email, 
        tempToken: tempToken ? `${tempToken.substring(0, 8)}...` : "missing",
        newPasswordLength: newPassword.length 
      });

      const res = await api.post("/auth/password/reset", {
        email: email.trim(),
        tempToken: tempToken.trim(),
        newPassword: newPassword.trim(),
        confirmPassword: confirmPassword.trim()
      });
      
      console.log("✅ Password reset response:", res.data);
      setMessage("🎉 Password reset successfully! Redirecting to login...");
      setIsSuccess(true);
      
      setTimeout(() => {
        window.location.href = "/auth/login?message=password_reset_success";
      }, 2000);
    } catch (err: any) {
      console.error("❌ Password reset error:", err);
      
      let errorMessage = "Failed to reset password. Please try again.";
      
      if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      } else if (err.response?.status === 400) {
        errorMessage = "Invalid request. Your session may have expired. Please start over.";
      } else if (err.response?.status === 401) {
        errorMessage = "Security token expired. Please request a new verification code.";
      }

      setMessage(errorMessage);
      setIsSuccess(false);

      // If token is invalid/expired, reset the flow
      if (errorMessage.toLowerCase().includes('token') || 
          errorMessage.toLowerCase().includes('expired') ||
          err.response?.status === 401) {
        setTimeout(() => {
          setStep("request");
          setTempToken("");
          setOtp("");
        }, 3000);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (countdown > 0) return;
    
    setLoading(true);
    setMessage(null);

    try {
      await api.post("/auth/password/forgot", { email });
      setMessage("New verification code sent to your email.");
      setIsSuccess(true);
      startCountdown();
    } catch (err: any) {
      setMessage(err.response?.data?.message || "Failed to resend code. Please try again.");
      setIsSuccess(false);
    } finally {
      setLoading(false);
    }
  };

  const getPasswordStrength = (password: string) => {
    if (password.length === 0) return { strength: 0, text: "", color: "bg-gray-200" };
    if (password.length < 8) return { strength: 1, text: "Too short", color: "bg-red-400" };
    
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;

    const colors = ["bg-red-400", "bg-orange-400", "bg-yellow-400", "bg-blue-400", "bg-green-500"];
    const texts = ["Weak", "Fair", "Good", "Strong", "Very Strong"];
    
    return { 
      strength, 
      text: texts[strength - 1] || "", 
      color: colors[strength - 1] || "bg-gray-200" 
    };
  };

  const passwordStrength = getPasswordStrength(newPassword);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6 transition-transform hover:scale-105">
            <div className="h-16 w-16 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-lg">
              <span className="text-white font-bold text-xl">TE</span>
            </div>
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Reset Your Password
          </h1>
          <p className="text-gray-600 text-lg">
            {step === "request" && "Enter your email to get started"}
            {step === "verify" && "Enter the verification code"}
            {step === "reset" && "Create your new password"}
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center space-x-4">
            {[
              { label: "Request", step: "request" },
              { label: "Verify", step: "verify" }, 
              { label: "Reset", step: "reset" }
            ].map(({ label, step: stepName }, index) => {
              const stepIndex = ["request", "verify", "reset"].indexOf(step);
              const isCompleted = index < stepIndex;
              const isCurrent = index === stepIndex;
              
              return (
                <div key={stepName} className="flex items-center">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-300 ${
                    isCompleted 
                      ? "bg-green-500 border-green-500 text-white shadow-lg" 
                      : isCurrent
                      ? "bg-blue-600 border-blue-600 text-white shadow-lg scale-110"
                      : "bg-white border-gray-300 text-gray-500"
                  }`}>
                    {isCompleted ? (
                      <CheckCircle className="h-5 w-5" />
                    ) : (
                      <span className="text-sm font-bold">{index + 1}</span>
                    )}
                  </div>
                  {index < 2 && (
                    <div className={`w-12 h-1 transition-all duration-300 ${
                      isCompleted ? "bg-green-500" : "bg-gray-300"
                    }`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Card className="border-0 shadow-xl rounded-2xl overflow-hidden bg-white/80 backdrop-blur-sm">
          <div className={`h-2 transition-all duration-500 ${
            step === "request" ? "bg-blue-600" : 
            step === "verify" ? "bg-purple-600" : 
            "bg-green-600"
          }`} />
          
          <CardHeader className="text-center pb-6 bg-gradient-to-r from-white to-gray-50/80">
            <CardTitle className="text-2xl font-bold text-gray-900">
              {step === "request" && "Reset Your Password"}
              {step === "verify" && "Enter Verification Code"}
              {step === "reset" && "Create New Password"}
            </CardTitle>
            <CardDescription className="text-gray-600 text-base">
              {step === "request" && "We'll send a 6-digit code to your email"}
              {step === "verify" && `Enter the code sent to ${email}`}
              {step === "reset" && "Choose a strong, secure password"}
            </CardDescription>
          </CardHeader>

          <CardContent className="p-6 space-y-6">
            {/* Request Reset Form */}
            {step === "request" && (
              <form onSubmit={handleRequestReset} className="space-y-6">
                <div className="space-y-3">
                  <label htmlFor="email" className="text-sm font-medium text-gray-700">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="Enter your email address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="pl-11 h-12 text-lg border-2 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all duration-300 bg-white"
                      disabled={loading}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full h-12 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02] disabled:opacity-50 disabled:transform-none"
                >
                  {loading ? (
                    <div className="flex items-center justify-center">
                      <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-3" />
                      Sending Code...
                    </div>
                  ) : (
                    "Send Verification Code"
                  )}
                </Button>
              </form>
            )}

            {/* Verify OTP Form */}
            {step === "verify" && (
              <form onSubmit={handleVerifyOtp} className="space-y-6">
                <div className="space-y-3">
                  <label htmlFor="otp" className="text-sm font-medium text-gray-700">
                    6-Digit Verification Code
                  </label>
                  <Input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Enter 6-digit code"
                    value={otp}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '');
                      setOtp(value.slice(0, 6));
                    }}
                    required
                    className="h-12 text-center text-xl font-mono border-2 border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200 transition-all duration-300 bg-white"
                    maxLength={6}
                    disabled={loading}
                  />
                  <p className="text-sm text-gray-500 text-center">
                    Enter the code sent to <strong>{email}</strong>
                  </p>
                </div>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={loading || countdown > 0}
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                  >
                    {countdown > 0 
                      ? `Resend code in ${countdown}s` 
                      : "Didn't receive code? Resend"}
                  </button>
                </div>

                <Button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="w-full h-12 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02] disabled:opacity-50 disabled:transform-none"
                >
                  {loading ? (
                    <div className="flex items-center justify-center">
                      <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-3" />
                      Verifying...
                    </div>
                  ) : (
                    "Verify Code"
                  )}
                </Button>
              </form>
            )}

            {/* Reset Password Form */}
            {step === "reset" && (
              <form onSubmit={handleResetPassword} className="space-y-6">
                <div className="space-y-3">
                  <label htmlFor="newPassword" className="text-sm font-medium text-gray-700">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                    <Input
                      id="newPassword"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      className="pl-11 pr-11 h-12 text-lg border-2 border-gray-300 focus:border-green-500 focus:ring-2 focus:ring-green-200 transition-all duration-300 bg-white"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors duration-200"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  
                  {/* Password Strength Indicator */}
                  {newPassword && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Password strength:</span>
                        <span className={`font-medium ${
                          passwordStrength.strength >= 4 ? "text-green-600" :
                          passwordStrength.strength >= 3 ? "text-yellow-600" :
                          passwordStrength.strength >= 2 ? "text-orange-600" :
                          "text-red-600"
                        }`}>
                          {passwordStrength.text}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all duration-500 ${passwordStrength.color}`}
                          style={{ 
                            width: `${(passwordStrength.strength / 5) * 100}%` 
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="pl-11 pr-11 h-12 text-lg border-2 border-gray-300 focus:border-green-500 focus:ring-2 focus:ring-green-200 transition-all duration-300 bg-white"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors duration-200"
                    >
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  
                  {/* Password Match Indicator */}
                  {confirmPassword && (
                    <div className={`flex items-center text-sm ${
                      newPassword === confirmPassword ? "text-green-600" : "text-red-600"
                    }`}>
                      {newPassword === confirmPassword ? (
                        <CheckCircle className="h-4 w-4 mr-2" />
                      ) : (
                        <AlertCircle className="h-4 w-4 mr-2" />
                      )}
                      {newPassword === confirmPassword ? "Passwords match" : "Passwords do not match"}
                    </div>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={loading || newPassword !== confirmPassword || newPassword.length < 8}
                  className="w-full h-12 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02] disabled:opacity-50 disabled:transform-none disabled:bg-gray-400"
                >
                  {loading ? (
                    <div className="flex items-center justify-center">
                      <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-3" />
                      Resetting Password...
                    </div>
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              </form>
            )}

            {/* Message Display */}
            {message && (
              <div className={`p-4 rounded-xl border-2 transition-all duration-300 ${
                isSuccess 
                  ? "bg-green-50 border-green-200 text-green-800 shadow-sm" 
                  : "bg-red-50 border-red-200 text-red-800 shadow-sm"
              }`}>
                <div className="flex items-start">
                  {isSuccess ? (
                    <CheckCircle className="h-5 w-5 mr-3 mt-0.5 flex-shrink-0 text-green-500" />
                  ) : (
                    <AlertCircle className="h-5 w-5 mr-3 mt-0.5 flex-shrink-0 text-red-500" />
                  )}
                  <p className="text-sm leading-relaxed">{message}</p>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="flex justify-center border-t border-gray-200/60 bg-gray-50/50 py-6">
            <Link 
              href="/auth/login" 
              className="flex items-center text-blue-600 hover:text-blue-700 font-semibold transition-all duration-200 hover:scale-105"
            >
              <ArrowLeft className="mr-2 h-5 w-5" />
              Back to Login
            </Link>
          </CardFooter>
        </Card>

        {/* Debug Info - Remove in production */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800 font-mono">
              Debug: Step: {step} | Email: {email} | Token: {tempToken ? `${tempToken.substring(0, 8)}...` : "None"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}