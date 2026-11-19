import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    employeeCount: { type: Number, default: 0 },
    deviceCount: { type: Number, default: 0 },
    policyCount: { type: Number, default: 0 },
    createdAt: { type: String, default: () => new Date().toISOString() },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const Department = mongoose.model('Department', departmentSchema);
