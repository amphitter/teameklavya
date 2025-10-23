"use client";

import { useState } from "react";
import { api } from "@/utils/api";

interface RegistrationField {
  label: string;
  type: "text" | "email" | "number" | "dropdown" | "checkbox" | "file";
  required: boolean;
  options?: string[];
  autoFillFromProfile?: "institution" | "course" | "year";
  value?: any;
}

interface RegistrationFormProps {
  eventId: string;
  eventTitle: string;
  requiredProfileFields: {
    institution: boolean;
    course: boolean;
    year: boolean;
  };
  customFields?: RegistrationField[];
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function RegistrationForm({
  eventId,
  eventTitle,
  requiredProfileFields,
  customFields = [],
  onSuccess,
  onCancel,
}: RegistrationFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [fileUploads, setFileUploads] = useState<Record<string, File>>({});

  // Default fields that are always included
  const defaultFields: RegistrationField[] = [
    {
      label: "Full Name",
      type: "text",
      required: true,
      autoFillFromProfile: undefined,
    },
    {
      label: "Email",
      type: "email",
      required: true,
      autoFillFromProfile: undefined,
    },
  ];

  // Add required profile fields
  const profileFields: RegistrationField[] = [];
  if (requiredProfileFields.institution) {
    profileFields.push({
      label: "Institution/Organization",
      type: "text",
      required: true,
      autoFillFromProfile: "institution",
    });
  }
  if (requiredProfileFields.course) {
    profileFields.push({
      label: "Course/Program",
      type: "text",
      required: true,
      autoFillFromProfile: "course",
    });
  }
  if (requiredProfileFields.year) {
    profileFields.push({
      label: "Academic Year",
      type: "text",
      required: true,
      autoFillFromProfile: "year",
    });
  }

  // Combine all fields: default + profile + custom
  const allFields = [...defaultFields, ...profileFields, ...customFields];

  const handleInputChange = (fieldLabel: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [fieldLabel]: value,
    }));
  };

  const handleFileChange = (fieldLabel: string, file: File) => {
    setFileUploads(prev => ({
      ...prev,
      [fieldLabel]: file,
    }));
  };

  const uploadFile = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    
    const response = await api.post("/upload/local?folder=registration-files", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    
    if (response.data.success) {
      return response.data.filePath;
    }
    throw new Error("File upload failed");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Process file uploads first
      const processedFormData = { ...formData };
      
      for (const [fieldLabel, file] of Object.entries(fileUploads)) {
        try {
          const fileUrl = await uploadFile(file);
          processedFormData[fieldLabel] = fileUrl;
        } catch (error) {
          console.error(`Failed to upload file for ${fieldLabel}:`, error);
          setError(`Failed to upload file for ${fieldLabel}. Please try again.`);
          setLoading(false);
          return;
        }
      }

      // Convert form data to answers format
      const answers = Object.entries(processedFormData).map(([fieldLabel, value]) => ({
        fieldLabel,
        fieldType: allFields.find(f => f.label === fieldLabel)?.type || "text",
        value,
      }));

      const response = await api.post("/registration/responses", {
        eventId,
        answers,
      });

      if (response.data.success) {
        onSuccess?.();
      } else {
        setError(response.data.message || "Registration failed");
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to register for event");
    } finally {
      setLoading(false);
    }
  };

  const renderField = (field: RegistrationField) => {
    const commonProps = {
      required: field.required,
      value: formData[field.label] || "",
      onChange: (e: React.ChangeEvent<any>) => 
        handleInputChange(field.label, e.target.value),
      className: "w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500",
    };

    switch (field.type) {
      case "email":
        return <input type="email" {...commonProps} />;
      
      case "number":
        return <input type="number" {...commonProps} />;
      
      case "dropdown":
        return (
          <select {...commonProps}>
            <option value="">Select an option</option>
            {field.options?.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        );
      
      case "checkbox":
        return (
          <div className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={!!formData[field.label]}
              onChange={(e) => handleInputChange(field.label, e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-5 w-5"
            />
            <span className="text-sm text-gray-700">
              {field.required && <span className="text-red-500 mr-1">*</span>}
              {field.label}
            </span>
          </div>
        );
      
      case "file":
        return (
          <div className="space-y-2">
            <input
              type="file"
              onChange={(e) => handleFileChange(field.label, e.target.files?.[0]!)}
              className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              required={field.required}
            />
            {fileUploads[field.label] && (
              <p className="text-sm text-green-600">
                ✓ {fileUploads[field.label].name} selected
              </p>
            )}
          </div>
        );
      
      default:
        return <input type="text" {...commonProps} />;
    }
  };

  const getFieldLabel = (field: RegistrationField) => {
    if (field.type === 'checkbox') {
      return null; // Checkbox includes its own label
    }
    return (
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {field.label} {field.required && <span className="text-red-500">*</span>}
      </label>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Register for {eventTitle}</h2>
          <p className="text-gray-600 mt-1">Please fill out the registration form</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Default and Profile Fields */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
              Personal Information
            </h3>
            {[...defaultFields, ...profileFields].map((field) => (
              <div key={field.label}>
                {getFieldLabel(field)}
                {renderField(field)}
              </div>
            ))}
          </div>

          {/* Custom Fields */}
          {customFields.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                Additional Information
              </h3>
              {customFields.map((field) => (
                <div key={field.label}>
                  {getFieldLabel(field)}
                  {renderField(field)}
                </div>
              ))}
            </div>
          )}

          {/* Required Fields Note */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs text-blue-700">
              <span className="text-red-500">*</span> indicates required fields
            </p>
          </div>

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Registering...
                </>
              ) : (
                "Register"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}