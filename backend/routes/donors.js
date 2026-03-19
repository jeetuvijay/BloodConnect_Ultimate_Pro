const express = require('express');
const Donation = require('../models/Donation');
const User = require('../models/User');
const BloodRequest = require('../models/BloodRequest');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// @desc    Get donor dashboard data
// @route   GET /api/donors/dashboard
// @access  Private/Donor
router.get('/dashboard', protect, authorize('donor'), async (req, res) => {
  try {
    const donorId = req.user.id;

    // Get donor stats
    const stats = await Donation.aggregate([
      { $match: { donor: req.user._id, status: 'completed' } },
      {
        $group: {
          _id: null,
          totalDonations: { $sum: 1 },
          totalUnits: { $sum: '$units' },
          lastDonation: { $max: '$donationDate' }
        }
      }
    ]);

    // Get recent donations
    const recentDonations = await Donation.find({ donor: donorId })
      .populate('hospital', 'name hospitalName')
      .sort({ donationDate: -1 })
      .limit(5);

    // Get upcoming appointments (mock data for now)
    const upcomingAppointments = [];

    // Get donation history for chart
    const donationHistory = await Donation.aggregate([
      { $match: { donor: req.user._id, status: 'completed' } },
      {
        $group: {
          _id: {
            year: { $year: '$donationDate' },
            month: { $month: '$donationDate' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Check eligibility
    const lastDonation = stats[0]?.lastDonation;
    const isEligible = !lastDonation || (new Date() - new Date(lastDonation)) > (56 * 24 * 60 * 60 * 1000); // 56 days

    res.json({
      success: true,
      dashboard: {
        stats: stats[0] || { totalDonations: 0, totalUnits: 0, lastDonation: null },
        recentDonations,
        upcomingAppointments,
        donationHistory,
        isEligible,
        nextEligibleDate: lastDonation ? new Date(new Date(lastDonation).getTime() + 56 * 24 * 60 * 60 * 1000) : null
      }
    });
  } catch (error) {
    console.error('Get donor dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get donor profile
// @route   GET /api/donors/profile
// @access  Private/Donor
router.get('/profile', protect, authorize('donor'), async (req, res) => {
  try {
    const donor = await User.findById(req.user.id)
      .select('-password')
      .populate('donations');

    if (!donor) {
      return res.status(404).json({
        success: false,
        message: 'Donor not found'
      });
    }

    // Get donation statistics
    const donationStats = await Donation.aggregate([
      { $match: { donor: req.user._id, status: 'completed' } },
      {
        $group: {
          _id: null,
          totalDonations: { $sum: 1 },
          totalUnits: { $sum: '$units' },
          bloodTypes: { $addToSet: '$bloodType' },
          lastDonation: { $max: '$donationDate' }
        }
      }
    ]);

    res.json({
      success: true,
      profile: {
        ...donor.toObject(),
        donationStats: donationStats[0] || {
          totalDonations: 0,
          totalUnits: 0,
          bloodTypes: [],
          lastDonation: null
        }
      }
    });
  } catch (error) {
    console.error('Get donor profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update donor profile
// @route   PUT /api/donors/profile
// @access  Private/Donor
router.put('/profile', protect, authorize('donor'), async (req, res) => {
  try {
    const fieldsToUpdate = {
      name: req.body.name,
      phone: req.body.phone,
      bio: req.body.bio,
      address: req.body.address,
      emergencyContact: req.body.emergencyContact,
      preferences: req.body.preferences,
      weight: req.body.weight,
      height: req.body.height,
      medicalConditions: req.body.medicalConditions,
      medications: req.body.medications
    };

    // Remove undefined fields
    Object.keys(fieldsToUpdate).forEach(key => {
      if (fieldsToUpdate[key] === undefined) {
        delete fieldsToUpdate[key];
      }
    });

    const donor = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
      new: true,
      runValidators: true
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      donor
    });
  } catch (error) {
    console.error('Update donor profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get available donation opportunities
// @route   GET /api/donors/opportunities
// @access  Private/Donor
router.get('/opportunities', protect, authorize('donor'), async (req, res) => {
  try {
    const donor = await User.findById(req.user.id);

    // Find nearby blood requests that match donor's blood type
    let query = {
      bloodType: donor.bloodType,
      status: { $in: ['pending', 'matched'] },
      expiresAt: { $gt: new Date() }
    };

    // Add location filter if donor has location
    if (donor.location && donor.location.coordinates) {
      query.location = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: donor.location.coordinates
          },
          $maxDistance: 50000 // 50km
        }
      };
    }

    const opportunities = await BloodRequest.find(query)
      .populate('hospital', 'name hospitalName phone address')
      .sort({ urgency: -1, createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      opportunities
    });
  } catch (error) {
    console.error('Get donation opportunities error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Respond to donation request
// @route   POST /api/donors/respond/:requestId
// @access  Private/Donor
router.post('/respond/:requestId', protect, authorize('donor'), async (req, res) => {
  try {
    const { available, notes } = req.body;
    const requestId = req.params.requestId;

    const bloodRequest = await BloodRequest.findById(requestId);
    if (!bloodRequest) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check if request is still active
    if (!['pending', 'matched'].includes(bloodRequest.status)) {
      return res.status(400).json({
        success: false,
        message: 'This request is no longer active'
      });
    }

    // Check blood type compatibility
    if (req.user.bloodType !== bloodRequest.bloodType) {
      return res.status(400).json({
        success: false,
        message: 'Your blood type is not compatible with this request'
      });
    }

    // Check if donor is already matched
    const existingMatch = bloodRequest.matchedDonors.find(
      match => match.donor.toString() === req.user.id
    );

    if (existingMatch) {
      // Update existing match
      existingMatch.status = available ? 'confirmed' : 'cancelled';
      if (notes) existingMatch.notes = notes;
    } else if (available) {
      // Add new match
      bloodRequest.matchedDonors.push({
        donor: req.user.id,
        status: 'confirmed',
        notes: notes || ''
      });
    }

    await bloodRequest.save();
    await bloodRequest.populate('matchedDonors.donor', 'name email phone');

    res.json({
      success: true,
      message: available ? 'Thank you for your willingness to donate!' : 'Response recorded',
      request: bloodRequest
    });
  } catch (error) {
    console.error('Respond to request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Schedule donation appointment
// @route   POST /api/donors/schedule
// @access  Private/Donor
router.post('/schedule', protect, authorize('donor'), async (req, res) => {
  try {
    const { hospitalId, donationDate, bloodType, notes } = req.body;

    // Check if hospital exists
    const hospital = await User.findById(hospitalId);
    if (!hospital || hospital.role !== 'hospital') {
      return res.status(404).json({
        success: false,
        message: 'Hospital not found'
      });
    }

    // Check donor eligibility
    const lastDonation = await Donation.findOne(
      { donor: req.user.id, status: 'completed' },
      {},
      { sort: { donationDate: -1 } }
    );

    if (lastDonation) {
      const daysSinceLastDonation = (new Date() - new Date(lastDonation.donationDate)) / (1000 * 60 * 60 * 24);
      if (daysSinceLastDonation < 56) {
        return res.status(400).json({
          success: false,
          message: 'You must wait at least 56 days between donations'
        });
      }
    }

    // Create donation record
    const donation = await Donation.create({
      donor: req.user.id,
      hospital: hospitalId,
      donationDate,
      bloodType: bloodType || req.user.bloodType,
      status: 'scheduled',
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Donation appointment scheduled successfully',
      donation
    });
  } catch (error) {
    console.error('Schedule donation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get donor donation history
// @route   GET /api/donors/history
// @access  Private/Donor
router.get('/history', protect, authorize('donor'), async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const total = await Donation.countDocuments({ donor: req.user.id });
    const donations = await Donation.find({ donor: req.user.id })
      .populate('hospital', 'name hospitalName')
      .sort({ donationDate: -1 })
      .skip(startIndex)
      .limit(limit);

    res.json({
      success: true,
      count: donations.length,
      total,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        limit
      },
      donations
    });
  } catch (error) {
    console.error('Get donation history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get donor achievements/badges
// @route   GET /api/donors/achievements
// @access  Private/Donor
router.get('/achievements', protect, authorize('donor'), async (req, res) => {
  try {
    const donorStats = await Donation.aggregate([
      { $match: { donor: req.user._id, status: 'completed' } },
      {
        $group: {
          _id: null,
          totalDonations: { $sum: 1 },
          totalUnits: { $sum: '$units' },
          firstDonation: { $min: '$donationDate' },
          lastDonation: { $max: '$donationDate' }
        }
      }
    ]);

    const stats = donorStats[0] || { totalDonations: 0, totalUnits: 0 };

    const achievements = [];

    // First Time Donor
    if (stats.totalDonations >= 1) {
      achievements.push({
        name: 'First Time Donor',
        description: 'Completed your first blood donation',
        icon: 'fas fa-star',
        color: 'text-yellow-500',
        unlocked: true
      });
    }

    // Regular Donor (5+ donations)
    if (stats.totalDonations >= 5) {
      achievements.push({
        name: 'Regular Donor',
        description: 'Completed 5 or more donations',
        icon: 'fas fa-medal',
        color: 'text-blue-500',
        unlocked: true
      });
    }

    // Life Saver (10+ donations)
    if (stats.totalDonations >= 10) {
      achievements.push({
        name: 'Life Saver',
        description: 'Completed 10 or more donations',
        icon: 'fas fa-heart',
        color: 'text-red-500',
        unlocked: true
      });
    }

    // Dedicated Donor (25+ donations)
    if (stats.totalDonations >= 25) {
      achievements.push({
        name: 'Dedicated Donor',
        description: 'Completed 25 or more donations',
        icon: 'fas fa-trophy',
        color: 'text-purple-500',
        unlocked: true
      });
    }

    // Emergency Responder
    const emergencyDonations = await Donation.countDocuments({
      donor: req.user._id,
      'bloodRequest.isEmergency': true,
      status: 'completed'
    });

    if (emergencyDonations > 0) {
      achievements.push({
        name: 'Emergency Responder',
        description: 'Responded to emergency blood requests',
        icon: 'fas fa-ambulance',
        color: 'text-green-500',
        unlocked: true
      });
    }

    res.json({
      success: true,
      achievements,
      stats
    });
  } catch (error) {
    console.error('Get achievements error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;