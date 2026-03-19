const express = require('express');
const User = require('../models/User');
const BloodRequest = require('../models/BloodRequest');
const Donation = require('../models/Donation');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// @desc    Get hospital dashboard
// @route   GET /api/hospitals/dashboard
// @access  Private/Hospital
router.get('/dashboard', protect, authorize('hospital'), async (req, res) => {
  try {
    const hospitalId = req.user.id;

    // Get hospital stats
    const stats = await BloodRequest.aggregate([
      { $match: { hospital: req.user._id } },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          pendingRequests: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          matchedRequests: { $sum: { $cond: [{ $eq: ['$status', 'matched'] }, 1, 0] } },
          fulfilledRequests: { $sum: { $cond: [{ $eq: ['$status', 'fulfilled'] }, 1, 0] } },
          totalUnitsRequested: { $sum: '$unitsRequired' },
          totalUnitsFulfilled: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'fulfilled'] },
                '$unitsRequired',
                0
              ]
            }
          }
        }
      }
    ]);

    // Get recent requests
    const recentRequests = await BloodRequest.find({ hospital: hospitalId })
      .populate('matchedDonors.donor', 'name email phone bloodType')
      .sort({ createdAt: -1 })
      .limit(5);

    // Get blood inventory (mock data - in real app, this would be a separate collection)
    const bloodInventory = [
      { type: 'A+', units: 45, status: 'adequate' },
      { type: 'A-', units: 12, status: 'low' },
      { type: 'B+', units: 28, status: 'adequate' },
      { type: 'B-', units: 8, status: 'critical' },
      { type: 'AB+', units: 15, status: 'adequate' },
      { type: 'AB-', units: 3, status: 'critical' },
      { type: 'O+', units: 52, status: 'adequate' },
      { type: 'O-', units: 6, status: 'low' }
    ];

    // Get upcoming donations
    const upcomingDonations = await Donation.find({
      hospital: hospitalId,
      status: 'scheduled',
      donationDate: { $gte: new Date() }
    })
      .populate('donor', 'name email phone bloodType')
      .sort({ donationDate: 1 })
      .limit(10);

    res.json({
      success: true,
      dashboard: {
        stats: stats[0] || {
          totalRequests: 0,
          pendingRequests: 0,
          matchedRequests: 0,
          fulfilledRequests: 0,
          totalUnitsRequested: 0,
          totalUnitsFulfilled: 0
        },
        recentRequests,
        bloodInventory,
        upcomingDonations
      }
    });
  } catch (error) {
    console.error('Get hospital dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get hospital blood requests
// @route   GET /api/hospitals/requests
// @access  Private/Hospital
router.get('/requests', protect, authorize('hospital'), async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const total = await BloodRequest.countDocuments({ hospital: req.user.id });
    const requests = await BloodRequest.find({ hospital: req.user.id })
      .populate('matchedDonors.donor', 'name email phone bloodType')
      .sort({ createdAt: -1 })
      .skip(startIndex)
      .limit(limit);

    res.json({
      success: true,
      count: requests.length,
      total,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        limit
      },
      requests
    });
  } catch (error) {
    console.error('Get hospital requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Create blood request
// @route   POST /api/hospitals/requests
// @access  Private/Hospital
router.post('/requests', protect, authorize('hospital'), async (req, res) => {
  try {
    const { patientId, bloodType, unitsRequired, urgency, reason, additionalNotes, doctorName, doctorContact, location } = req.body;

    // Check if patient ID already exists for this hospital
    const existingRequest = await BloodRequest.findOne({
      patientId,
      hospital: req.user.id,
      status: { $in: ['pending', 'matched'] }
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'An active request already exists for this patient'
      });
    }

    const request = await BloodRequest.create({
      patientId,
      hospital: req.user.id,
      bloodType,
      unitsRequired,
      urgency: urgency || 'medium',
      reason,
      additionalNotes,
      doctorName,
      doctorContact,
      location,
      createdBy: req.user.id
    });

    await request.populate('hospital', 'name email phone hospitalName');

    res.status(201).json({
      success: true,
      message: 'Blood request created successfully',
      request
    });
  } catch (error) {
    console.error('Create hospital request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update blood request
// @route   PUT /api/hospitals/requests/:id
// @access  Private/Hospital
router.put('/requests/:id', protect, authorize('hospital'), async (req, res) => {
  try {
    const request = await BloodRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check ownership
    if (request.hospital.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this request'
      });
    }

    // Prevent updates if fulfilled or cancelled
    if (['fulfilled', 'cancelled'].includes(request.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update fulfilled or cancelled requests'
      });
    }

    const fieldsToUpdate = {
      unitsRequired: req.body.unitsRequired,
      urgency: req.body.urgency,
      additionalNotes: req.body.additionalNotes,
      doctorName: req.body.doctorName,
      doctorContact: req.body.doctorContact,
      location: req.body.location,
      updatedBy: req.user.id
    };

    // Remove undefined fields
    Object.keys(fieldsToUpdate).forEach(key => {
      if (fieldsToUpdate[key] === undefined) {
        delete fieldsToUpdate[key];
      }
    });

    const updatedRequest = await BloodRequest.findByIdAndUpdate(req.params.id, fieldsToUpdate, {
      new: true,
      runValidators: true
    }).populate('matchedDonors.donor', 'name email phone bloodType');

    res.json({
      success: true,
      message: 'Request updated successfully',
      request: updatedRequest
    });
  } catch (error) {
    console.error('Update hospital request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get hospital donations
// @route   GET /api/hospitals/donations
// @access  Private/Hospital
router.get('/donations', protect, authorize('hospital'), async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    const total = await Donation.countDocuments({ hospital: req.user.id });
    const donations = await Donation.find({ hospital: req.user.id })
      .populate('donor', 'name email phone bloodType')
      .populate('bloodRequest', 'patientId bloodType')
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
    console.error('Get hospital donations error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Record donation
// @route   POST /api/hospitals/donations
// @access  Private/Hospital
router.post('/donations', protect, authorize('hospital'), async (req, res) => {
  try {
    const {
      donorId,
      bloodType,
      units,
      donationDate,
      requestId,
      screeningResults,
      complications,
      staffNotes
    } = req.body;

    // Verify donor exists
    const donor = await User.findById(donorId);
    if (!donor || donor.role !== 'donor') {
      return res.status(404).json({
        success: false,
        message: 'Donor not found'
      });
    }

    // If linked to a request, verify it exists and belongs to this hospital
    let bloodRequest = null;
    if (requestId) {
      bloodRequest = await BloodRequest.findById(requestId);
      if (!bloodRequest || bloodRequest.hospital.toString() !== req.user.id) {
        return res.status(404).json({
          success: false,
          message: 'Blood request not found or does not belong to this hospital'
        });
      }
    }

    // Create donation record
    const donation = await Donation.create({
      donor: donorId,
      hospital: req.user.id,
      bloodRequest: requestId || null,
      donationDate,
      bloodType,
      units,
      screeningResults,
      complications: complications || 'none',
      staffNotes,
      status: 'completed',
      createdBy: req.user.id
    });

    // Update donor's donation count
    await User.findByIdAndUpdate(donorId, {
      $inc: { donationCount: 1 },
      lastDonation: donationDate
    });

    // If linked to request, update request status
    if (bloodRequest) {
      const donorMatch = bloodRequest.matchedDonors.find(
        match => match.donor.toString() === donorId
      );

      if (donorMatch) {
        donorMatch.status = 'completed';
        donorMatch.donationDate = donationDate;
        donorMatch.unitsDonated = units;
        await bloodRequest.save();
      }
    }

    await donation.populate('donor', 'name email phone bloodType');
    if (bloodRequest) {
      await donation.populate('bloodRequest', 'patientId bloodType');
    }

    res.status(201).json({
      success: true,
      message: 'Donation recorded successfully',
      donation
    });
  } catch (error) {
    console.error('Record donation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get blood inventory
// @route   GET /api/hospitals/inventory
// @access  Private/Hospital
router.get('/inventory', protect, authorize('hospital'), async (req, res) => {
  try {
    // In a real application, this would be a separate Inventory collection
    // For now, we'll calculate based on donations and requests

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Get donations in last 30 days
    const recentDonations = await Donation.aggregate([
      {
        $match: {
          hospital: req.user._id,
          status: 'completed',
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: '$bloodType',
          unitsReceived: { $sum: '$units' }
        }
      }
    ]);

    // Get current requests
    const currentRequests = await BloodRequest.aggregate([
      {
        $match: {
          hospital: req.user._id,
          status: { $in: ['pending', 'matched'] },
          expiresAt: { $gt: new Date() }
        }
      },
      {
        $group: {
          _id: '$bloodType',
          unitsRequested: { $sum: '$unitsRequired' }
        }
      }
    ]);

    // Mock inventory levels (in real app, this would be stored)
    const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    const inventory = bloodTypes.map(type => {
      const donations = recentDonations.find(d => d._id === type);
      const requests = currentRequests.find(r => r._id === type);

      // Mock current stock (in real app, this would be tracked)
      const mockStock = Math.floor(Math.random() * 50) + 10;

      return {
        bloodType: type,
        currentStock: mockStock,
        unitsReceived: donations ? donations.unitsReceived : 0,
        unitsRequested: requests ? requests.unitsRequested : 0,
        available: mockStock - (requests ? requests.unitsRequested : 0),
        status: mockStock > 20 ? 'adequate' : mockStock > 10 ? 'low' : 'critical'
      };
    });

    res.json({
      success: true,
      inventory,
      lastUpdated: new Date()
    });
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Search for donors
// @route   GET /api/hospitals/donors/search
// @access  Private/Hospital
router.get('/donors/search', protect, authorize('hospital'), async (req, res) => {
  try {
    const { bloodType, latitude, longitude, maxDistance = 50000 } = req.query;

    let query = {
      role: 'donor',
      isActive: true,
      isEligible: true
    };

    if (bloodType) {
      query.bloodType = bloodType;
    }

    if (latitude && longitude) {
      query.location = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          $maxDistance: parseInt(maxDistance)
        }
      };
    }

    const donors = await User.find(query)
      .select('name email phone bloodType address location lastDonation donationCount')
      .sort({ donationCount: -1 })
      .limit(20);

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

module.exports = router;