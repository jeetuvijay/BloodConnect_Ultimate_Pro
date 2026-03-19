const express = require('express');
const User = require('../models/User');
const BloodRequest = require('../models/BloodRequest');
const Donation = require('../models/Donation');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// @desc    Get dashboard analytics
// @route   GET /api/analytics/dashboard
// @access  Private/Admin
router.get('/dashboard', protect, authorize('admin'), async (req, res) => {
  try {
    // Date range (default to last 30 days)
    const endDate = new Date();
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // User statistics
    const userStats = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 },
          active: { $sum: { $cond: ['$isActive', 1, 0] } },
          verified: { $sum: { $cond: ['$isVerified', 1, 0] } }
        }
      }
    ]);

    // Blood request statistics
    const requestStats = await BloodRequest.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalUnits: { $sum: '$unitsRequired' }
        }
      }
    ]);

    // Donation statistics
    const donationStats = await Donation.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalDonations: { $sum: 1 },
          totalUnits: { $sum: '$units' },
          uniqueDonors: { $addToSet: '$donor' }
        }
      }
    ]);

    // Blood type distribution
    const bloodTypeStats = await User.aggregate([
      { $match: { role: 'donor' } },
      {
        $group: {
          _id: '$bloodType',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Emergency requests
    const emergencyStats = await BloodRequest.aggregate([
      {
        $match: {
          isEmergency: true,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Monthly trends (last 12 months)
    const monthlyTrends = await Donation.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          donations: { $sum: 1 },
          units: { $sum: '$units' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json({
      success: true,
      analytics: {
        userStats,
        requestStats,
        donationStats: donationStats[0] || { totalDonations: 0, totalUnits: 0, uniqueDonors: [] },
        bloodTypeStats,
        emergencyStats,
        monthlyTrends,
        dateRange: {
          start: startDate,
          end: endDate
        }
      }
    });
  } catch (error) {
    console.error('Get dashboard analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get donor analytics
// @route   GET /api/analytics/donors
// @access  Private
router.get('/donors', protect, async (req, res) => {
  try {
    let query = { role: 'donor' };

    // If not admin, only show own stats
    if (req.user.role !== 'admin') {
      query._id = req.user.id;
    }

    const donorStats = await User.aggregate([
      { $match: query },
      {
        $lookup: {
          from: 'donations',
          localField: '_id',
          foreignField: 'donor',
          as: 'donations'
        }
      },
      {
        $project: {
          name: 1,
          email: 1,
          bloodType: 1,
          donationCount: 1,
          lastDonation: 1,
          totalDonations: { $size: '$donations' },
          totalUnits: { $sum: '$donations.units' },
          isActive: 1,
          isEligible: 1
        }
      },
      { $sort: { totalDonations: -1 } }
    ]);

    res.json({
      success: true,
      donorStats
    });
  } catch (error) {
    console.error('Get donor analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get hospital analytics
// @route   GET /api/analytics/hospitals
// @access  Private
router.get('/hospitals', protect, async (req, res) => {
  try {
    let query = { role: 'hospital' };

    // If not admin, only show own stats
    if (req.user.role !== 'admin') {
      query._id = req.user.id;
    }

    const hospitalStats = await User.aggregate([
      { $match: query },
      {
        $lookup: {
          from: 'bloodrequests',
          localField: '_id',
          foreignField: 'hospital',
          as: 'requests'
        }
      },
      {
        $lookup: {
          from: 'donations',
          localField: '_id',
          foreignField: 'hospital',
          as: 'donations'
        }
      },
      {
        $project: {
          name: 1,
          hospitalName: 1,
          email: 1,
          phone: 1,
          totalRequests: { $size: '$requests' },
          activeRequests: {
            $size: {
              $filter: {
                input: '$requests',
                cond: { $in: ['$$this.status', ['pending', 'matched']] }
              }
            }
          },
          fulfilledRequests: {
            $size: {
              $filter: {
                input: '$requests',
                cond: { $eq: ['$$this.status', 'fulfilled'] }
              }
            }
          },
          totalDonations: { $size: '$donations' },
          totalUnits: { $sum: '$donations.units' }
        }
      },
      { $sort: { totalRequests: -1 } }
    ]);

    res.json({
      success: true,
      hospitalStats
    });
  } catch (error) {
    console.error('Get hospital analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get blood inventory analytics
// @route   GET /api/analytics/inventory
// @access  Private
router.get('/inventory', protect, async (req, res) => {
  try {
    // Current blood requests by type
    const currentRequests = await BloodRequest.aggregate([
      {
        $match: {
          status: { $in: ['pending', 'matched'] },
          expiresAt: { $gt: new Date() }
        }
      },
      {
        $group: {
          _id: '$bloodType',
          totalRequests: { $sum: 1 },
          totalUnitsNeeded: { $sum: '$unitsRequired' },
          criticalRequests: {
            $sum: { $cond: [{ $eq: ['$urgency', 'critical'] }, 1, 0] }
          }
        }
      }
    ]);

    // Recent donations by type (last 30 days)
    const recentDonations = await Donation.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: '$bloodType',
          totalDonations: { $sum: 1 },
          totalUnits: { $sum: '$units' }
        }
      }
    ]);

    // Blood type availability
    const donorAvailability = await User.aggregate([
      { $match: { role: 'donor', isActive: true, isEligible: true } },
      {
        $group: {
          _id: '$bloodType',
          availableDonors: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      inventory: {
        currentRequests,
        recentDonations,
        donorAvailability
      }
    });
  } catch (error) {
    console.error('Get inventory analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get geographic analytics
// @route   GET /api/analytics/geographic
// @access  Private/Admin
router.get('/geographic', protect, authorize('admin'), async (req, res) => {
  try {
    // Requests by location
    const requestsByLocation = await BloodRequest.aggregate([
      {
        $match: {
          'location.city': { $exists: true }
        }
      },
      {
        $group: {
          _id: {
            city: '$location.city',
            state: '$location.state'
          },
          totalRequests: { $sum: 1 },
          activeRequests: {
            $sum: { $cond: [{ $in: ['$status', ['pending', 'matched']] }, 1, 0] }
          }
        }
      },
      { $sort: { totalRequests: -1 } },
      { $limit: 20 }
    ]);

    // Donors by location
    const donorsByLocation = await User.aggregate([
      {
        $match: {
          role: 'donor',
          'address.city': { $exists: true }
        }
      },
      {
        $group: {
          _id: {
            city: '$address.city',
            state: '$address.state'
          },
          totalDonors: { $sum: 1 },
          activeDonors: {
            $sum: { $cond: ['$isActive', 1, 0] }
          }
        }
      },
      { $sort: { totalDonors: -1 } },
      { $limit: 20 }
    ]);

    res.json({
      success: true,
      geographic: {
        requestsByLocation,
        donorsByLocation
      }
    });
  } catch (error) {
    console.error('Get geographic analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Export analytics data
// @route   GET /api/analytics/export
// @access  Private/Admin
router.get('/export', protect, authorize('admin'), async (req, res) => {
  try {
    const { type, format = 'json' } = req.query;

    let data;

    switch (type) {
      case 'users':
        data = await User.find({}).select('-password');
        break;
      case 'requests':
        data = await BloodRequest.find({})
          .populate('hospital', 'name email')
          .populate('matchedDonors.donor', 'name email');
        break;
      case 'donations':
        data = await Donation.find({})
          .populate('donor', 'name email bloodType')
          .populate('hospital', 'name hospitalName');
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid export type'
        });
    }

    if (format === 'csv') {
      // In a real app, you'd convert to CSV format
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${type}.csv`);
      // Convert data to CSV...
    } else {
      res.json({
        success: true,
        data,
        exportedAt: new Date(),
        count: data.length
      });
    }
  } catch (error) {
    console.error('Export analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;