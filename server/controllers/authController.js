const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const User   = require('../models/User');

if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
}

// ─── Citizen ID Generator ─────────────────────────────────────────────────────
/**
 * Generates a unique Citizen ID in the format CIV-XXXXXXXX
 * (8 random uppercase hex characters = 4 294 967 296 possible values).
 * Retries if a collision occurs (extremely rare).
 */
async function generateCitizenId() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = 'CIV-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const exists = await User.findOne({ citizenId: id }).select('_id').lean();
    if (!exists) return id;
  }
  // Fallback: use timestamp + random — guaranteed unique
  return 'CIV-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
}

const register = async (req, res) => {
  try {
    const { name, email, password, role, profileDetails, govKey } = req.body;

    // GOV accounts cannot be self-registered publicly.
    // They require the GOV_ACCESS_KEY env secret (if configured) and are otherwise
    // provisioned via the seedAdmin script.
    let allowedRole = 'Citizen';
    if (role === 'GOV') {
      if (!process.env.GOV_ACCESS_KEY || govKey !== process.env.GOV_ACCESS_KEY) {
        return res.status(403).json({ error: 'GOV registration requires a valid access key.' });
      }
      allowedRole = 'GOV';
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate a unique Citizen ID only for Citizen accounts.
    // GOV accounts omit the field entirely (the sparse unique index only
    // indexes documents that carry citizenId, so multiple GOVs never collide).
    const citizenId = allowedRole === 'Citizen' ? await generateCitizenId() : undefined;

    const user = new User({
      name,
      email,
      password: hashedPassword,
      role: allowedRole,
      ...(citizenId ? { citizenId } : {}),
      profileDetails: profileDetails || {},
    });

    await user.save();
    console.log(`✅ New citizen registered: ${user.email} | ID: ${citizenId}`);

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id:             user._id,
        name:           user.name,
        email:          user.email,
        role:           user.role,
        citizenId:      user.citizenId,
        profileDetails: user.profileDetails,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration.' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id:             user._id,
        name:           user.name,
        email:          user.email,
        role:           user.role,
        citizenId:      user.citizenId || null,
        profileDetails: user.profileDetails,
        profilePicture: user.profilePicture || '',
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login.' });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(user);
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Server error fetching profile.' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { name, email, profileDetails } = req.body;

    // Check if new email is already taken by someone else
    if (email) {
      const existing = await User.findOne({ email });
      if (existing && String(existing._id) !== String(req.user.userId)) {
        return res.status(400).json({ error: 'Email already in use by another account.' });
      }
    }

    const updates = {};
    if (name)           updates.name           = name;
    if (email)          updates.email          = email;
    if (profileDetails) updates.profileDetails = profileDetails;
    // Save profilePicture only when explicitly provided (not empty string)
    if (typeof req.body.profilePicture === 'string' && req.body.profilePicture) {
      updates.profilePicture = req.body.profilePicture;
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ message: 'Profile updated successfully.', user });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Server error updating profile.' });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Incorrect current password.' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Server error changing password.' });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({ error: 'Server error deleting account.' });
  }
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  changePassword,
  deleteAccount,
};
