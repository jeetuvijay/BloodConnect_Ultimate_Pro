const express = require('express');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const total = await User.countDocuments();
    const users = await User.find()
      .skip(startIndex)
      .limit(limit)
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: users.length,
      total,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        limit
      },
      users
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Only allow users to view their own profile or admins to view any profile
    if (req.user.id !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this profile'
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private/Admin
router.put('/:id', protect, async (req, res) => {
  try {
    // Only allow users to update their own profile or admins to update any profile
    if (req.user.id !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this profile'
      });
    }

    const fieldsToUpdate = {
      name: req.body.name,
      phone: req.body.phone,
      bio: req.body.bio,
      address: req.body.address,
      emergencyContact: req.body.emergencyContact,
      preferences: req.body.preferences,
      isActive: req.body.isActive,
      isVerified: req.body.isVerified
    };

    // Add role-specific fields
    if (req.user.role === 'donor' || req.user.role === 'admin') {
      fieldsToUpdate.weight = req.body.weight;
      fieldsToUpdate.height = req.body.height;
      fieldsToUpdate.medicalConditions = req.body.medicalConditions;
      fieldsToUpdate.medications = req.body.medications;
    }

    if (req.user.role === 'hospital' || req.user.role === 'admin') {
      fieldsToUpdate.hospitalName = req.body.hospitalName;
      fieldsToUpdate.licenseNumber = req.body.licenseNumber;
    }

    // Remove undefined fields
    Object.keys(fieldsToUpdate).forEach(key => {
      if (fieldsToUpdate[key] === undefined) {
        delete fieldsToUpdate[key];
      }
    });

    const user = await User.findByIdAndUpdate(req.params.id, fieldsToUpdate, {
      new: true,
      runValidators: true
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      user
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private/Admin
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await User.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get donors by blood type and location
// @route   GET /api/users/donors/search
// @access  Private
router.get('/donors/search', protect, async (req, res) => {
  try {
    const { bloodType, location, urgency } = req.query;

    let query = {
      role: 'donor',
      isActive: true,
      isEligible: true
    };

    if (bloodType && bloodType !== '') {
      query.bloodType = bloodType;
    }

    if (location && location !== '') {
      query.$or = [
        { address: { $regex: location, $options: 'i' } },
        { 'location.city': { $regex: location, $options: 'i' } },
        { 'location.state': { $regex: location, $options: 'i' } }
      ];
    }

    // For urgency, we can add later if needed

    const donors = await User.find(query)
      .select('firstName lastName name email phone bloodType address location lastDonation donationCount')
      .sort({ donationCount: -1 });

    res.json({
      success: true,
      count: donors.length,
      donors
    });
  } catch (error) {
    console.error('Search donors error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get user statistics
// @route   GET /api/users/stats
// @access  Private/Admin
router.get('/stats/overview', protect, authorize('admin'), async (req, res) => {
  try {
    const stats = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 },
          active: {
            $sum: { $cond: ['$isActive', 1, 0] }
          },
          verified: {
            $sum: { $cond: ['$isVerified', 1, 0] }
          }
        }
      }
    ]);

    const bloodTypeStats = await User.aggregate([
      { $match: { role: 'donor' } },
      {
        $group: {
          _id: '$bloodType',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      stats,
      bloodTypeStats
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;