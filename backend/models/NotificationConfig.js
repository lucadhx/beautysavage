import mongoose from 'mongoose';

const categoryConfigSchema = new mongoose.Schema({
  id:        { type: String, required: true },
  label:     { type: String, required: true },
  icon:      { type: String, default: 'bi-bell' },
  color:     { type: String, default: '#6b7280' },

}, { _id: false });

const eventConfigSchema = new mongoose.Schema({
  eventType:          { type: String, required: true },
  label:              { type: String, required: true },
  isActive:           { type: Boolean, default: true },
  category:           { type: String, default: null },
  targetType:         { type: String, enum: ['all', 'role', 'user_concerned'], default: 'all' },
  targetRole:         { type: String, default: null },
  titleTemplate:      { type: String, default: '' },
  messageTemplate:    { type: String, default: '' },
  availableVariables: [{ type: String }]
}, { _id: false });

const notificationConfigSchema = new mongoose.Schema({
  widgetPosition: {
    type: String,
    enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    default: 'bottom-right'
  },
  pollingIntervalSeconds:   { type: Number, default: 30 },
  notificationLifetimeDays: { type: Number, default: 30 },
  categories: [categoryConfigSchema],
  events:     [eventConfigSchema]
});

const NotificationConfig = mongoose.model('NotificationConfig', notificationConfigSchema);
export default NotificationConfig;
