const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema({
  donor: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'Donor is required']
  },

  hospital: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'Hospital is required']
  },

  bloodRequest: {
    type: mongoose.Schema.ObjectId,
    ref: 'BloodRequest'
  },

  donationDetails: {
    bloodType: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
      required: [true, 'Blood type is required']
    },
    component: {
      type: String,
      enum: ['whole-blood', 'plasma', 'platelets', 'red-cells', 'cryoprecipitate'],
      default: 'whole-blood'
    },
    units: {
      type: Number,
      required: [true, 'Number of units is required'],
      min: [0.5, 'Minimum 0.5 units'],
      max: [2, 'Maximum 2 units per donation']
    },
    volume: {
      type: Number, // in mL
      default: function() {
        return this.units * 450; // Standard 450mL per unit
      }
    }
  },

  donationDate: {
    type: Date,
    required: [true, 'Donation date is required'],
    default: Date.now
  },

  status: {
    type: String,
    enum: ['scheduled', 'in-progress', 'completed', 'cancelled', 'rejected'],
    default: 'scheduled'
  },

  screening: {
    passed: {
      type: Boolean,
      default: null
    },
    reason: {
      type: String,
      enum: ['passed', 'low-hemoglobin', 'blood-pressure', 'medication', 'travel-history', 'medical-condition', 'other']
    },
    notes: String,
    screenedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    screenedAt: Date
  },

  testing: {
    hiv: { type: String, enum: ['negative', 'positive', 'pending'] },
    hepatitisB: { type: String, enum: ['negative', 'positive', 'pending'] },
    hepatitisC: { type: String, enum: ['negative', 'positive', 'pending'] },
    syphilis: { type: String, enum: ['negative', 'positive', 'pending'] },
    malaria: { type: String, enum: ['negative', 'positive', 'pending'] },
    status: {
      type: String,
      enum: ['pending', 'in-progress', 'completed', 'failed'],
      default: 'pending'
    },
    testedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    testedAt: Date,
    results: String
  },

  processing: {
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'discarded'],
      default: 'pending'
    },
    processedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    processedAt: Date,
    storage: {
      unitNumber: String,
      location: String,
      expiryDate: Date
    }
  },

  vitalSigns: {
    weight: Number, // in kg
    height: Number, // in cm
    bloodPressure: {
      systolic: Number,
      diastolic: Number
    },
    pulse: Number,
    temperature: Number,
    hemoglobin: Number
  },

  medicalInfo: {
    lastDonation: Date,
    totalDonations: Number,
    deferralReason: String,
    medications: [String],
    allergies: [String]
  },

  donorExperience: {
    comfort: {
      type: String,
      enum: ['very-comfortable', 'comfortable', 'uncomfortable', 'very-uncomfortable']
    },
    sideEffects: [String],
    satisfaction: {
      type: Number,
      min: 1,
      max: 5
    },
    comments: String,
    wouldRecommend: Boolean
  },

  timeline: {
    scheduledAt: Date,
    arrivedAt: Date,
    screeningStartedAt: Date,
    screeningCompletedAt: Date,
    donationStartedAt: Date,
    donationCompletedAt: Date,
    departedAt: Date
  },

  staff: {
    phlebotomist: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    nurse: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    supervisor: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    }
  },

  followUp: {
    reminderSent: { type: Boolean, default: false },
    thankYouSent: { type: Boolean, default: false },
    nextEligibleDate: Date,
    notes: String
  },

  quality: {
    bagNumber: String,
    sealIntact: Boolean,
    color: String,
    clots: Boolean,
    contamination: Boolean
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
donationSchema.index({ donor: 1, donationDate: -1 });
donationSchema.index({ hospital: 1, donationDate: -1 });
donationSchema.index({ bloodRequest: 1 });
donationSchema.index({ status: 1 });
donationSchema.index({ 'donationDetails.bloodType': 1 });
donationSchema.index({ donationDate: -1 });

// Virtual for duration
donationSchema.virtual('duration').get(function() {
  if (this.timeline.donationStartedAt && this.timeline.donationCompletedAt) {
    return Math.round((this.timeline.donationCompletedAt - this.timeline.donationStartedAt) / (1000 * 60)); // in minutes
  }
  return null;
});

// Virtual for donor age at donation
donationSchema.virtual('donorAge').get(async function() {
  if (this.donor && this.donor.dateOfBirth) {
    const donor = await mongoose.model('User').findById(this.donor);
    if (donor && donor.dateOfBirth) {
      return Math.floor((new Date(this.donationDate) - new Date(donor.dateOfBirth)) / (365.25 * 24 * 60 * 60 * 1000));
    }
  }
  return null;
});

// Pre-save middleware
donationSchema.pre('save', async function(next) {
  if (this.isNew && this.donor) {
    // Update donor's stats
    const donor = await mongoose.model('User').findById(this.donor);
    if (donor) {
      donor.stats.totalDonations += 1;
      donor.stats.lastDonation = this.donationDate;

      // Calculate next eligible date (56 days for whole blood)
      if (this.donationDetails.component === 'whole-blood') {
        this.followUp.nextEligibleDate = new Date(this.donationDate.getTime() + 56 * 24 * 60 * 60 * 1000);
        donor.stats.nextEligibleDonation = this.followUp.nextEligibleDate;
      }

      await donor.save({ validateBeforeSave: false });
    }
  }

  // Update blood request if this fulfills it
  if (this.bloodRequest && this.status === 'completed') {
    const bloodRequest = await mongoose.model('BloodRequest').findById(this.bloodRequest);
    if (bloodRequest) {
      bloodRequest.fulfilledBy.push({
        donor: this.donor,
        donation: this._id,
        units: this.donationDetails.units,
        fulfilledAt: new Date()
      });

      // Check if request is fully fulfilled
      const totalFulfilled = bloodRequest.fulfilledBy.reduce((sum, f) => sum + (f.units || 0), 0);
      if (totalFulfilled >= bloodRequest.bloodRequirements.units) {
        bloodRequest.status = 'fulfilled';
        bloodRequest.timeline.fulfilledAt = new Date();
      }

      await bloodRequest.save();
    }
  }

  next();
});

// Static method to get donation statistics
donationSchema.statics.getStats = async function(startDate, endDate) {
  const match = {};
  if (startDate && endDate) {
    match.donationDate = { $gte: startDate, $lte: endDate };
  }

  return await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalDonations: { $sum: 1 },
        totalUnits: { $sum: '$donationDetails.units' },
        bloodTypeBreakdown: {
          $push: '$donationDetails.bloodType'
        },
        componentBreakdown: {
          $push: '$donationDetails.component'
        }
      }
    },
    {
      $project: {
        totalDonations: 1,
        totalUnits: 1,
        bloodTypeStats: {
          $arrayToObject: {
            $map: {
              input: { $setUnion: ['$bloodTypeBreakdown'] },
              as: 'type',
              in: {
                k: '$$type',
                v: {
                  $size: {
                    $filter: {
                      input: '$bloodTypeBreakdown',
                      cond: { $eq: ['$$this', '$$type'] }
                    }
                  }
                }
              }
            }
          }
        },
        componentStats: {
          $arrayToObject: {
            $map: {
              input: { $setUnion: ['$componentBreakdown'] },
              as: 'component',
              in: {
                k: '$$component',
                v: {
                  $size: {
                    $filter: {
                      input: '$componentBreakdown',
                      cond: { $eq: ['$$this', '$$component'] }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  ]);
};

module.exports = mongoose.model('Donation', donationSchema);