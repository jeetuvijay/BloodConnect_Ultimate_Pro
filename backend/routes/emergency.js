const express = require('express');
const { body, validationResult } = require('express-validator');
const BloodRequest = require('../models/BloodRequest');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// @desc    Create emergency blood request
// @route   POST /api/emergency
// @access  Private/Hospital/Admin
router.post('/', protect, authorize('hospital', 'admin'), [
  body('hospitalName').trim().isLength({ min: 2 }).withMessage('Hospital name is required'),
  body('contactPerson').trim().isLength({ min: 2 }).withMessage('Contact person is required'),
  body('hospitalPhone').trim().isLength({ min: 10 }).withMessage('Valid phone number is required'),
  body('hospitalEmail').isEmail().withMessage('Valid email is required'),
  body('bloodType').isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).withMessage('Invalid blood type'),
  body('unitsRequired').isInt({ min: 1, max: 5 }).withMessage('Units required must be 1-5 for emergency'),
  body('urgencyLevel').isIn(['critical', 'urgent', 'high']).withMessage('Invalid urgency level'),
  body('requestReason').isIn(['Emergency Surgery', 'Accident/Trauma', 'Cancer Treatment', 'Severe Anemia', 'Organ Transplant', 'Other Medical Emergency']).withMessage('Invalid reason')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      hospitalName,
      contactPerson,
      hospitalPhone,
      hospitalEmail,
      hospitalAddress,
      bloodType,
      unitsRequired,
      urgencyLevel,
      patientInfo,
      requestReason,
      additionalDetails
    } = req.body;

    // Generate unique patient ID for emergency
    const patientId = `EMERGENCY-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Map urgency level to internal format
    const urgencyMap = {
      'critical': 'critical',
      'urgent': 'high',
      'high': 'high'
    };

    // Create emergency blood request
    const emergencyRequest = await BloodRequest.create({
      patientId,
      hospital: req.user.id,
      bloodType,
      unitsRequired,
      urgency: urgencyMap[urgencyLevel],
      reason: requestReason,
      additionalNotes: additionalDetails,
      doctorName: contactPerson,
      doctorContact: hospitalPhone,
      location: {
        address: hospitalAddress
      },
      isEmergency: true,
      emergencyDetails: {
        contactPerson,
        contactPhone: hospitalPhone,
        additionalInfo: additionalDetails
      },
      createdBy: req.user.id,
      status: 'pending'
    });

    // Find compatible donors nearby (within 100km)
    const compatibleDonors = await User.find({
      role: 'donor',
      bloodType: bloodType,
      isActive: true,
      isEligible: true,
      // Add location filter if coordinates available
      ...(req.body.latitude && req.body.longitude && {
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [parseFloat(req.body.longitude), parseFloat(req.body.latitude)]
            },
            $maxDistance: 100000 // 100km
          }
        }
      })
    }).select('name email phone bloodType address location').limit(10);

    // Auto-match top 3 compatible donors
    if (compatibleDonors.length > 0) {
      const matches = compatibleDonors.slice(0, 3).map(donor => ({
        donor: donor._id,
        unitsDonated: 1,
        status: 'pending'
      }));

      emergencyRequest.matchedDonors = matches;
      await emergencyRequest.save();
    }

    await emergencyRequest.populate('matchedDonors.donor', 'name email phone bloodType');

    // Send notifications (in a real app, this would trigger email/SMS)
    console.log(`🚨 EMERGENCY ALERT: ${bloodType} blood needed at ${hospitalName}`);
    console.log(`Contact: ${contactPerson} - ${hospitalPhone}`);
    console.log(`Found ${compatibleDonors.length} potential donors nearby`);

    res.status(201).json({
      success: true,
      message: 'Emergency blood request created successfully. Our team will contact you within 30 minutes.',
      request: emergencyRequest,
      potentialDonors: compatibleDonors.length,
      autoMatched: emergencyRequest.matchedDonors.length
    });
  } catch (error) {
    console.error('Create emergency request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during emergency request creation'
    });
  }
});

// @desc    Get emergency requests
// @route   GET /api/emergency
// @access  Private/Admin
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const total = await BloodRequest.countDocuments({ isEmergency: true });
    const emergencies = await BloodRequest.find({ isEmergency: true })
      .populate('hospital', 'name email phone hospitalName')
      .populate('matchedDonors.donor', 'name email phone bloodType')
      .skip(startIndex)
      .limit(limit)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: emergencies.length,
      total,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        limit
      },
      emergencies
    });
  } catch (error) {
    console.error('Get emergencies error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get active emergency requests
// @route   GET /api/emergency/active
// @access  Private
router.get('/active/count', protect, async (req, res) => {
  try {
    const activeEmergencies = await BloodRequest.countDocuments({
      isEmergency: true,
      status: { $in: ['pending', 'matched'] },
      expiresAt: { $gt: new Date() }
    });

    const criticalCount = await BloodRequest.countDocuments({
      isEmergency: true,
      urgency: 'critical',
      status: { $in: ['pending', 'matched'] },
      expiresAt: { $gt: new Date() }
    });

    res.json({
      success: true,
      activeEmergencies,
      criticalCount
    });
  } catch (error) {
    console.error('Get active emergencies error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Respond to emergency request (for donors)
// @route   POST /api/emergency/:id/respond
// @access  Private/Donor
router.post('/:id/respond', protect, authorize('donor'), async (req, res) => {
  try {
    const { available, notes } = req.body;

    const emergency = await BloodRequest.findById(req.params.id);

    if (!emergency || !emergency.isEmergency) {
      return res.status(404).json({
        success: false,
        message: 'Emergency request not found'
      });
    }

    if (!['pending', 'matched'].includes(emergency.status)) {
      return res.status(400).json({
        success: false,
        message: 'This emergency request is no longer active'
      });
    }

    // Check if donor is compatible
    if (req.user.bloodType !== emergency.bloodType) {
      return res.status(400).json({
        success: false,
        message: 'Your blood type is not compatible with this request'
      });
    }

    // Find donor match
    const donorMatch = emergency.matchedDonors.find(
      match => match.donor.toString() === req.user.id
    );

    if (!donorMatch) {
      return res.status(400).json({
        success: false,
        message: 'You are not matched to this emergency request'
      });
    }

    // Update match status
    donorMatch.status = available ? 'confirmed' : 'cancelled';
    if (notes) {
      donorMatch.notes = notes;
    }

    await emergency.save();

    res.json({
      success: true,
      message: available ? 'Thank you for responding to this emergency!' : 'Response recorded',
      status: donorMatch.status
    });
  } catch (error) {
    console.error('Respond to emergency error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get emergency statistics
// @route   GET /api/emergency/stats
// @access  Private/Admin
router.get('/stats/overview', protect, authorize('admin'), async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const stats = await BloodRequest.aggregate([
      {
        $match: {
          isEmergency: true,
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          fulfilled: {
            $sum: { $cond: [{ $eq: ['$status', 'fulfilled'] }, 1, 0] }
          },
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          avgResponseTime: { $avg: '$createdAt' } // This would need more complex calculation
        }
      }
    ]);

    const bloodTypeStats = await BloodRequest.aggregate([
      {
        $match: {
          isEmergency: true,
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: '$bloodType',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      stats: stats[0] || { total: 0, fulfilled: 0, pending: 0 },
      bloodTypeStats
    });
  } catch (error) {
    console.error('Get emergency stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;