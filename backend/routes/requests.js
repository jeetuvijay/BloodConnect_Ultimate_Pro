const express = require('express');
const { body, validationResult } = require('express-validator');
const BloodRequest = require('../models/BloodRequest');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// @desc    Get all blood requests
// @route   GET /api/requests
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;

    let query = {};

    // Filter by status
    if (req.query.status) {
      query.status = req.query.status;
    }

    // Filter by blood type
    if (req.query.bloodType) {
      query.bloodType = req.query.bloodType;
    }

    // Filter by urgency
    if (req.query.urgency) {
      query.urgency = req.query.urgency;
    }

    // Filter by hospital (if not admin)
    if (req.user.role === 'hospital') {
      query.hospital = req.user.id;
    }

    // Filter by location if coordinates provided
    if (req.query.latitude && req.query.longitude) {
      const maxDistance = parseInt(req.query.maxDistance) || 50000;
      query.location = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(req.query.longitude), parseFloat(req.query.latitude)]
          },
          $maxDistance: maxDistance
        }
      };
    }

    const total = await BloodRequest.countDocuments(query);
    const requests = await BloodRequest.find(query)
      .populate('hospital', 'name email phone hospitalName')
      .populate('matchedDonors.donor', 'name email phone bloodType')
      .skip(startIndex)
      .limit(limit)
      .sort({ createdAt: -1 });

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
    console.error('Get requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get single blood request
// @route   GET /api/requests/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const request = await BloodRequest.findById(req.params.id)
      .populate('hospital', 'name email phone hospitalName address')
      .populate('matchedDonors.donor', 'name email phone bloodType address')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check permissions
    if (req.user.role !== 'admin' && request.hospital._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this request'
      });
    }

    res.json({
      success: true,
      request
    });
  } catch (error) {
    console.error('Get request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Create blood request
// @route   POST /api/requests
// @access  Private/Hospital
router.post('/', protect, authorize('hospital', 'admin'), [
  body('patientId').trim().isLength({ min: 1 }).withMessage('Patient ID is required'),
  body('bloodType').isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).withMessage('Invalid blood type'),
  body('unitsRequired').isInt({ min: 1, max: 10 }).withMessage('Units required must be 1-10'),
  body('urgency').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid urgency level'),
  body('reason').isIn(['Surgery', 'Accident/Trauma', 'Cancer Treatment', 'Anemia', 'Organ Transplant', 'Childbirth', 'Burns', 'Other Medical Emergency']).withMessage('Invalid reason')
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

    const { patientId, bloodType, unitsRequired, urgency = 'medium', reason, additionalNotes, doctorName, doctorContact, location } = req.body;

    // Check if patient ID already exists
    const existingRequest = await BloodRequest.findOne({ patientId, status: { $in: ['pending', 'matched'] } });
    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'An active request already exists for this patient'
      });
    }

    // Create request
    const request = await BloodRequest.create({
      patientId,
      hospital: req.user.role === 'admin' ? req.body.hospital : req.user.id,
      bloodType,
      unitsRequired,
      urgency,
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
    console.error('Create request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update blood request
// @route   PUT /api/requests/:id
// @access  Private/Hospital/Admin
router.put('/:id', protect, async (req, res) => {
  try {
    const request = await BloodRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check permissions
    if (req.user.role !== 'admin' && request.hospital.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this request'
      });
    }

    // Prevent updates if request is fulfilled or cancelled
    if (['fulfilled', 'cancelled'].includes(request.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update a fulfilled or cancelled request'
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
    }).populate('hospital', 'name email phone hospitalName');

    res.json({
      success: true,
      message: 'Blood request updated successfully',
      request: updatedRequest
    });
  } catch (error) {
    console.error('Update request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Delete blood request
// @route   DELETE /api/requests/:id
// @access  Private/Hospital/Admin
router.delete('/:id', protect, async (req, res) => {
  try {
    const request = await BloodRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check permissions
    if (req.user.role !== 'admin' && request.hospital.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this request'
      });
    }

    await BloodRequest.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Blood request deleted successfully'
    });
  } catch (error) {
    console.error('Delete request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Match donor to request
// @route   POST /api/requests/:id/match
// @access  Private/Hospital/Admin
router.post('/:id/match', protect, authorize('hospital', 'admin'), async (req, res) => {
  try {
    const { donorId, units } = req.body;

    const request = await BloodRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check permissions
    if (req.user.role !== 'admin' && request.hospital.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to match donors to this request'
      });
    }

    // Check if request is still active
    if (!['pending', 'matched'].includes(request.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot match donors to a fulfilled or cancelled request'
      });
    }

    // Check if donor exists and is eligible
    const donor = await User.findById(donorId);
    if (!donor || donor.role !== 'donor' || !donor.isEligible) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or ineligible donor'
      });
    }

    // Check blood type compatibility
    if (donor.bloodType !== request.bloodType) {
      return res.status(400).json({
        success: false,
        message: 'Donor blood type does not match request'
      });
    }

    // Check if donor is already matched
    const existingMatch = request.matchedDonors.find(match => match.donor.toString() === donorId);
    if (existingMatch) {
      return res.status(400).json({
        success: false,
        message: 'Donor is already matched to this request'
      });
    }

    // Add donor match
    request.matchedDonors.push({
      donor: donorId,
      unitsDonated: units || 1,
      status: 'pending'
    });

    await request.save();
    await request.populate('matchedDonors.donor', 'name email phone bloodType');

    res.json({
      success: true,
      message: 'Donor matched successfully',
      request
    });
  } catch (error) {
    console.error('Match donor error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update request status
// @route   PUT /api/requests/:id/status
// @access  Private/Hospital/Admin
router.put('/:id/status', protect, async (req, res) => {
  try {
    const { status } = req.body;

    if (!['pending', 'matched', 'fulfilled', 'cancelled'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const request = await BloodRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Blood request not found'
      });
    }

    // Check permissions
    if (req.user.role !== 'admin' && request.hospital.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this request status'
      });
    }

    request.status = status;
    if (status === 'fulfilled') {
      request.fulfilledAt = new Date();
    }
    request.updatedBy = req.user.id;

    await request.save();

    res.json({
      success: true,
      message: `Request status updated to ${status}`,
      request
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get nearby requests
// @route   GET /api/requests/nearby
// @access  Private
router.get('/nearby/search', protect, async (req, res) => {
  try {
    const { latitude, longitude, maxDistance = 50000, bloodType } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const requests = await BloodRequest.findNearby(
      parseFloat(longitude),
      parseFloat(latitude),
      parseInt(maxDistance)
    ).populate('hospital', 'name email phone hospitalName address');

    // Filter by blood type if specified
    let filteredRequests = requests;
    if (bloodType) {
      filteredRequests = requests.filter(request => request.bloodType === bloodType);
    }

    res.json({
      success: true,
      count: filteredRequests.length,
      requests: filteredRequests
    });
  } catch (error) {
    console.error('Nearby requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;