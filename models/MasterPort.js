import mongoose from 'mongoose';

const masterPortSchema = new mongoose.Schema(
  {
    port: { type: Number, required: true, unique: true },
    protocol: { type: String, enum: ['TCP', 'UDP', 'ANY'], default: 'TCP' },
    serviceName: { type: String, default: 'Standard Service' },
    description: { type: String, default: 'Approved corporate port' },
    isDefault: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
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

export const MasterPort = mongoose.model('MasterPort', masterPortSchema);
