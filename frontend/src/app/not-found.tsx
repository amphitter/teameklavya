"use client";
import { useRouter } from "next/navigation";

export default function NotFoundPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="text-center max-w-md mx-auto">
        {/* Animated 404 */}
        <div className="relative mb-8">
          <div className="text-9xl font-bold text-gray-800 mb-4">
            <span className="inline-block animate-bounce" style={{ animationDelay: '0.1s' }}>4</span>
            <span className="inline-block animate-bounce" style={{ animationDelay: '0.2s' }}>0</span>
            <span className="inline-block animate-bounce" style={{ animationDelay: '0.3s' }}>4</span>
          </div>
          <div className="absolute -inset-4 bg-gradient-to-r from-blue-200 to-purple-200 rounded-full blur-xl opacity-30 -z-10"></div>
        </div>

        {/* Content */}
        <h1 className="text-2xl font-bold text-gray-800 mb-4">
          Page Not Found
        </h1>
        
        <p className="text-gray-600 mb-8 leading-relaxed">
          Oops! The page you're looking for seems to have wandered off into the digital wilderness. 
          Don't worry, let's get you back on track.
        </p>

        {/* Action Button */}
        <button
          onClick={() => router.push('/')}
          className="group relative inline-flex items-center justify-center px-8 py-4 font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 overflow-hidden"
        >
          <span className="relative z-10 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Return Home
          </span>
          
          {/* Shimmer effect */}
          <div className="absolute inset-0 -skew-x-12 transform scale-150">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
          </div>
        </button>

        {/* Decorative elements */}
        <div className="mt-12 flex justify-center space-x-4 opacity-50">
          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0s' }}></div>
          <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
          <div className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
        </div>
      </div>

      {/* Custom styles for shimmer animation */}
      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </div>
  );
}