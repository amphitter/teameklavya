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
      CONTACT ADMIN FOR RESET
    </div>
  );
}