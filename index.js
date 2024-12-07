const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();

// Create HTTP server
const server = http.createServer(app);

// Set up Socket.IO with CORS configuration
const io = new Server(server, {
  cors: {
    origin: 'https://queue-management-system-nblk15hix-geeths-projects-5e4a8b6a.vercel.app', // Updated to the frontend URL
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors({
  origin: 'https://queue-management-system-nblk15hix-geeths-projects-5e4a8b6a.vercel.app', // Updated to frontend URL
  methods: ['GET', 'POST'],
}));
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Models
const Section = mongoose.model('Section', new mongoose.Schema({ name: String }));
const Queue = mongoose.model('Queue', new mongoose.Schema({
  membershipNumber: String,
  section: String,
  position: Number,
  isCurrentlyServing: { type: Boolean, default: false },
}));
const Customer = mongoose.model('Customer', new mongoose.Schema({
  membershipNo: String,
  name: String,
  designation: String,
  hospital: String,
}));

// SECTION ROUTES
app.post('/sections', async (req, res) => {
  try {
    const section = new Section(req.body);
    await section.save();
    io.emit('sectionAdded', section);
    res.status(201).send(section);
  } catch (err) {
    res.status(400).send(err.message);
  }
});

app.get('/sections', async (req, res) => {
  try {
    const sections = await Section.find();
    res.send(sections);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete('/sections/:id', async (req, res) => {
  try {
    const section = await Section.findByIdAndDelete(req.params.id);
    if (!section) {
      return res.status(404).send({ message: 'Section not found' });
    }
    await Queue.deleteMany({ section: section.name });
    io.emit('section-deleted', section._id);
    res.send({ message: 'Section and associated queues deleted' });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put('/sections/:id', async (req, res) => {
  try {
    const { name: newName } = req.body;
    const section = await Section.findById(req.params.id);
    if (!section) {
      return res.status(404).send({ message: 'Section not found' });
    }
    const oldName = section.name;
    section.name = newName;
    await section.save();
    await Queue.updateMany({ section: oldName }, { section: newName });
    io.emit('section-updated', section);
    res.send({ message: 'Section and associated queues updated successfully', section });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// CUSTOMER ROUTES
app.post('/customers', async (req, res) => {
  try {
    const customer = new Customer(req.body);
    await customer.save();
    res.status(201).send(customer);
  } catch (err) {
    res.status(400).send(err.message);
  }
});

app.get('/customers', async (req, res) => {
  try {
    const customers = await Customer.find();
    res.send(customers);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.put('/customers/:id', async (req, res) => {
  try {
    const { membershipNo, name, designation, hospital } = req.body;
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).send({ message: 'Customer not found' });
    }
    customer.membershipNo = membershipNo || customer.membershipNo;
    customer.name = name || customer.name;
    customer.designation = designation || customer.designation;
    customer.hospital = hospital || customer.hospital;
    await customer.save();
    res.send({ message: 'Customer updated successfully', customer });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete('/customers/:id', async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) {
      return res.status(404).send({ message: 'Customer not found' });
    }
    res.send({ message: 'Customer deleted' });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// QUEUE ROUTES
app.post('/queue', async (req, res) => {
  try {
    const { membershipNumber, section } = req.body;
    const position = (await Queue.countDocuments({ section })) + 1;
    const queueItem = new Queue({ membershipNumber, section, position });
    await queueItem.save();
    io.emit('queue-updated', { section });
    res.status(201).send(queueItem);
  } catch (err) {
    res.status(400).send(err.message);
  }
});

app.get('/queue/:section', async (req, res) => {
  try {
    const queue = await Queue.find({ section: req.params.section }).sort({ position: 1 });
    res.send(queue);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.delete('/queue/:id', async (req, res) => {
  try {
    const queueItem = await Queue.findById(req.params.id);
    const section = queueItem.section;
    await Queue.findByIdAndDelete(req.params.id);
    const queue = await Queue.find({ section }).sort({ position: 1 });
    for (const [index, item] of queue.entries()) {
      item.position = index + 1;
      await item.save();
    }
    io.emit('queue-updated', { section });
    res.send({ message: 'Queue updated' });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post('/finish-customer/:section', async (req, res) => {
  try {
    const currentCustomer = await Queue.findOneAndUpdate(
      { section: req.params.section, isCurrentlyServing: true },
      { isCurrentlyServing: false },
      { new: true }
    );
    if (!currentCustomer) {
      return res.status(400).send({ message: 'No customer is currently being served in this section.' });
    }
    const nextCustomer = await Queue.findOne({ section: req.params.section, position: currentCustomer.position + 1 });
    if (nextCustomer) {
      nextCustomer.isCurrentlyServing = true;
      await nextCustomer.save();
    }
    io.emit('queue-updated', { section: req.params.section });
    res.send({ message: 'Customer finished, and next customer is now being served.' });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/customers/:membershipNumber', async (req, res) => {
  try {
    const customer = await Customer.findOne({ membershipNo: req.params.membershipNumber });
    if (!customer) {
      return res.status(404).send({ message: 'Customer not found' });
    }
    res.send(customer);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
