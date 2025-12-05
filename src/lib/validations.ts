import { z } from 'zod';

// Class validation
export const createClassSchema = z.object({
  name: z.string()
    .trim()
    .min(1, "Class name is required")
    .max(100, "Class name must be less than 100 characters")
    .regex(/^[a-zA-Z0-9\s\-_]+$/, "Class name can only contain letters, numbers, spaces, hyphens, and underscores"),
  description: z.string()
    .trim()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .nullable(),
  college: z.string()
    .trim()
    .max(200, "College name must be less than 200 characters")
    .optional()
    .nullable(),
});

// Message validation
export const messageSchema = z.object({
  content: z.string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(2000, "Message must be less than 2000 characters"),
});

// Announcement validation
export const announcementSchema = z.object({
  title: z.string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be less than 200 characters"),
  content: z.string()
    .trim()
    .min(1, "Content is required")
    .max(5000, "Content must be less than 5000 characters"),
});

// Poll validation
export const pollSchema = z.object({
  question: z.string()
    .trim()
    .min(1, "Question is required")
    .max(500, "Question must be less than 500 characters"),
  options: z.array(
    z.string()
      .trim()
      .min(1, "Option cannot be empty")
      .max(200, "Option must be less than 200 characters")
  )
    .min(2, "At least 2 options required")
    .max(10, "Maximum 10 options allowed"),
});

// Calendar event validation
export const calendarEventSchema = z.object({
  title: z.string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be less than 200 characters"),
  description: z.string()
    .trim()
    .max(1000, "Description must be less than 1000 characters")
    .optional()
    .nullable(),
  event_date: z.string()
    .min(1, "Date is required"),
});

// Profile validation
export const profileSchema = z.object({
  full_name: z.string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be less than 100 characters")
    .regex(/^[a-zA-Z\s\-'.]+$/, "Name can only contain letters, spaces, hyphens, apostrophes, and periods"),
  college: z.string()
    .trim()
    .max(200, "College name must be less than 200 characters")
    .optional()
    .nullable(),
});

// Notice board validation
export const noticeBoardSchema = z.object({
  content: z.string()
    .trim()
    .min(1, "Content is required")
    .max(5000, "Content must be less than 5000 characters"),
});

// File upload validation
export const fileUploadSchema = z.object({
  name: z.string()
    .max(255, "Filename is too long"),
  size: z.number()
    .max(50 * 1024 * 1024, "File size must be less than 50MB"),
  type: z.string()
    .regex(/^[a-zA-Z0-9\/\-\+\.]+$/, "Invalid file type"),
});

// Document category validation
export const documentCategorySchema = z.object({
  name: z.string()
    .trim()
    .min(1, "Category name is required")
    .max(100, "Category name must be less than 100 characters"),
  description: z.string()
    .trim()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .nullable(),
});

// Auth validation
export const loginSchema = z.object({
  email: z.string()
    .trim()
    .email("Invalid email address")
    .max(255, "Email must be less than 255 characters"),
  password: z.string()
    .min(6, "Password must be at least 6 characters")
    .max(100, "Password must be less than 100 characters"),
});

export const signupSchema = loginSchema.extend({
  fullName: z.string()
    .trim()
    .min(1, "Full name is required")
    .max(100, "Name must be less than 100 characters"),
});

// Invite code validation
export const inviteCodeSchema = z.object({
  code: z.string()
    .trim()
    .min(1, "Invite code is required")
    .max(50, "Invalid invite code"),
});

// Private message validation
export const privateMessageSchema = z.object({
  content: z.string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(2000, "Message must be less than 2000 characters"),
});

// CR group chat message validation  
export const crMessageSchema = z.object({
  content: z.string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(5000, "Message must be less than 5000 characters"),
});
