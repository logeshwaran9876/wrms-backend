import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String },
    passwordSalt: { type: String },
    role: { type: String, enum: ['super_admin', 'admin', 'employee'], default: 'employee' },
    departmentId: { type: String },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    lastLogin: { type: String },
    createdAt: { type: String, default: () => new Date().toISOString() },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        delete ret.passwordSalt;
        return ret;
      },
    },
  }
);

export const User = mongoose.model('User', userSchema);
