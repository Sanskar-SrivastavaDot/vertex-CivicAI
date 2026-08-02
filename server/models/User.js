const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['Citizen', 'GOV'],
    default: 'Citizen',
  },
  // Permanent unique Citizen ID — generated at registration, never changes
  citizenId: {
    type: String,
    unique: true,
    sparse: true,   // allows null for GOV accounts (sparse = nulls are not indexed)
    default: null,
  },
  profileDetails: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  profilePicture: {
    type: String,
    default: '',
    validate: {
      validator: function (v) {
        // Allow empty string, or must be a URL (not a base64 data URI)
        return !v || v.startsWith('http://') || v.startsWith('https://');
      },
      message: 'profilePicture must be a URL. Upload the image to Cloudinary first and store the URL.',
    },
  },
  // Department for GOV users (which category they manage)
  department: {
    type: String,
    enum: ['Road & Traffic', 'Water & Drainage', 'Electricity', 'Sanitation', 'Public Property', null],
    default: null,
  },
}, {
  timestamps: true, // auto adds createdAt and updatedAt
});

module.exports = mongoose.model('User', userSchema);

