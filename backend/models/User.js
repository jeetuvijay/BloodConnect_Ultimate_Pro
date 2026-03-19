const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false // Don't include password in queries by default
  },
  phone: {
    type: String,
    required: [true, 'Please add a phone number'],
    match: [/^\+?[\d\s\-\(\)]+$/, 'Please add a valid phone number']
  },
  role: {
    type: String,
    enum: ['donor', 'hospital', 'admin'],
    default: 'donor'
  },

  // Donor specific fields
  bloodType: {
    type: String,
    enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
    required: function() { return this.role === 'donor'; }
  },
  dateOfBirth: {
    type: Date,
    required: function() { return this.role === 'donor'; }
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
    required: function() { return this.role === 'donor'; }
  },
  weight: {
    type: Number,
    min: [45, 'Weight must be at least 45kg']
  },
  height: {
    type: Number
  },
  medicalHistory: {
    allergies: [String],
    medications: [String],
    conditions: [String],
    surgeries: [{
      procedure: String,
      date: Date,
      notes: String
    }]
  },
  emergencyContact: {
    name: String,
    relationship: String,
    phone: String
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

  // Hospital specific fields
  hospitalName: {
    type: String,
    required: function() { return this.role === 'hospital'; }
  },
  licenseNumber: {
    type: String,
    required: function() { return this.role === 'hospital'; },
    unique: true
  },
  hospitalType: {
    type: String,
    enum: ['government', 'private', 'charity', 'military'],
    required: function() { return this.role === 'hospital'; }
  },
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  contactPerson: {
    name: String,
    designation: String,
    phone: String,
    email: String
  },
  facilities: {
    emergencyServices: { type: Boolean, default: false },
    bloodBank: { type: Boolean, default: false },
    icu: { type: Boolean, default: false },
    operationTheaters: { type: Number, default: 0 }
  },
  certifications: [String],

  // Common fields
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date
  },
  profilePicture: {
    type: String // URL to profile picture
  },
  notifications: {
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: true },
    push: { type: Boolean, default: true }
  },
  stats: {
    totalDonations: { type: Number, default: 0 },
    livesSaved: { type: Number, default: 0 },
    lastDonation: Date,
    nextEligibleDonation: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for better query performance
userSchema.index({ location: '2dsphere' });
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ bloodType: 1 });
userSchema.index({ 'location.city': 1 });

// Virtual for age (donor only)
userSchema.virtual('age').get(function() {
  if (this.role === 'donor' && this.dateOfBirth) {
    return Math.floor((new Date() - new Date(this.dateOfBirth)) / (365.25 * 24 * 60 * 60 * 1000));
  }
  return null;
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Match password method
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Update last login
userSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  return this.save({ validateBeforeSave: false });
};

// Check if donor is eligible for donation
userSchema.methods.isEligibleForDonation = function() {
  if (this.role !== 'donor') return false;

  const now = new Date();
  const age = this.age;

  // Age check (18-65)
  if (age < 18 || age > 65) return false;

  // Weight check (minimum 45kg)
  if (this.weight < 45) return false;

  // Last donation check (56 days for whole blood)
  if (this.stats.lastDonation) {
    const daysSinceLastDonation = Math.floor((now - this.stats.lastDonation) / (24 * 60 * 60 * 1000));
    if (daysSinceLastDonation < 56) return false;
  }

  // Medical conditions check
  const disqualifyingConditions = ['HIV', 'AIDS', 'Hepatitis B', 'Hepatitis C', 'Cancer'];
  if (this.medicalHistory.conditions.some(condition =>
    disqualifyingConditions.some(dc => condition.toLowerCase().includes(dc.toLowerCase()))
  )) {
    return false;
  }

  return true;
};

module.exports = mongoose.model('User', userSchema);