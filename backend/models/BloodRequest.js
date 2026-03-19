const mongoose = require('mongoose');

const bloodRequestSchema = new mongoose.Schema({
  requester: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'Requester is required']
  },

  patient: {
    name: {
      type: String,
      required: [true, 'Patient name is required'],
      trim: true
    },
    age: {
      type: Number,
      required: [true, 'Patient age is required'],
      min: [0, 'Age cannot be negative'],
      max: [150, 'Age cannot be more than 150']
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
      required: [true, 'Patient gender is required']
    },
    bloodType: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
      required: [true, 'Patient blood type is required']
    },
    diagnosis: {
      type: String,
      trim: true
    },
    medicalRecordNumber: {
      type: String,
      trim: true
    }
  },

  bloodRequirements: {
    bloodType: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
      required: [true, 'Required blood type is required']
    },
    units: {
      type: Number,
      required: [true, 'Number of units required'],
      min: [1, 'At least 1 unit is required'],
      max: [10, 'Cannot request more than 10 units']
    },
    component: {
      type: String,
      enum: ['whole-blood', 'plasma', 'platelets', 'red-cells', 'cryoprecipitate'],
      default: 'whole-blood'
    },
    urgency: {
      type: String,
      enum: ['routine', 'urgent', 'emergency'],
      default: 'routine'
    }
  },

  hospital: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'Hospital is required']
  },

  status: {
    type: String,
    enum: ['pending', 'approved', 'fulfilled', 'cancelled', 'expired'],
    default: 'pending'
  },

  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },

  location: {
    address: String,
    city: String,
    state: String,
    zipCode: String,
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    }
  },

  timeline: {
    requestedAt: {
      type: Date,
      default: Date.now
    },
    approvedAt: Date,
    fulfilledAt: Date,
    cancelledAt: Date,
    expiresAt: {
      type: Date,
      default: function() {
        const now = new Date();
        // Default expiry: 7 days for routine, 24 hours for urgent, 6 hours for emergency
        const hours = this.bloodRequirements.urgency === 'emergency' ? 6 :
                     this.bloodRequirements.urgency === 'urgent' ? 24 : 168;
        return new Date(now.getTime() + hours * 60 * 60 * 1000);
      }
    }
  },

  assignedDonors: [{
    donor: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    assignedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['assigned', 'confirmed', 'completed', 'cancelled'],
      default: 'assigned'
    },
    notes: String
  }],

  fulfilledBy: [{
    donor: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    donation: {
      type: mongoose.Schema.ObjectId,
      ref: 'Donation'
    },
    units: Number,
    fulfilledAt: {
      type: Date,
      default: Date.now
    }
  }],

  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot be more than 500 characters']
  },

  attachments: [{
    filename: String,
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],

  notifications: {
    emailSent: { type: Boolean, default: false },
    smsSent: { type: Boolean, default: false },
    pushSent: { type: Boolean, default: false },
    lastNotification: Date
  },

  stats: {
    views: { type: Number, default: 0 },
    responses: { type: Number, default: 0 },
    matches: { type: Number, default: 0 }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
bloodRequestSchema.index({ 'bloodRequirements.bloodType': 1 });
bloodRequestSchema.index({ 'bloodRequirements.urgency': 1 });
bloodRequestSchema.index({ status: 1 });
bloodRequestSchema.index({ hospital: 1 });
bloodRequestSchema.index({ 'timeline.expiresAt': 1 });
bloodRequestSchema.index({ location: '2dsphere' });

// Virtual for time remaining
bloodRequestSchema.virtual('timeRemaining').get(function() {
  if (this.status === 'fulfilled' || this.status === 'cancelled') return null;

  const now = new Date();
  const expiresAt = new Date(this.timeline.expiresAt);
  const diff = expiresAt - now;

  if (diff <= 0) return 'Expired';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m remaining`;
  } else {
    return `${minutes}m remaining`;
  }
});

// Virtual for progress percentage
bloodRequestSchema.virtual('progress').get(function() {
  const required = this.bloodRequirements.units;
  const fulfilled = this.fulfilledBy.reduce((sum, f) => sum + (f.units || 0), 0);
  return Math.min(Math.round((fulfilled / required) * 100), 100);
});

// Pre-save middleware to update priority based on urgency
bloodRequestSchema.pre('save', function(next) {
  if (this.bloodRequirements.urgency === 'emergency') {
    this.priority = 'critical';
  } else if (this.bloodRequirements.urgency === 'urgent') {
    this.priority = 'high';
  } else if (this.isNew) {
    this.priority = 'medium';
  }
  next();
});

// Static method to find compatible donors
bloodRequestSchema.statics.findCompatibleDonors = async function(requestId) {
  const request = await this.findById(requestId).populate('hospital');
  if (!request) return [];

  const bloodType = request.bloodRequirements.bloodType;
  const location = request.location;

  // Blood type compatibility matrix
  const compatibilityMatrix = {
    'O-': ['O-'],
    'O+': ['O-', 'O+'],
    'A-': ['O-', 'A-'],
    'A+': ['O-', 'O+', 'A-', 'A+'],
    'B-': ['O-', 'B-'],
    'B+': ['O-', 'O+', 'B-', 'B+'],
    'AB-': ['O-', 'A-', 'B-', 'AB-'],
    'AB+': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+']
  };

  const compatibleTypes = compatibilityMatrix[bloodType] || [bloodType];

  let query = {
    role: 'donor',
    bloodType: { $in: compatibleTypes },
    isActive: true,
    isVerified: true
  };

  // Add location filter if coordinates are available
  if (location && location.coordinates) {
    query['location.coordinates'] = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: location.coordinates
        },
        $maxDistance: 50000 // 50km radius
      }
    };
  }

  return await mongoose.model('User').find(query)
    .select('name email phone bloodType location stats')
    .sort({ 'stats.totalDonations': -1 });
};

module.exports = mongoose.model('BloodRequest', bloodRequestSchema);