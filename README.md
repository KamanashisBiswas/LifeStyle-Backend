# Express Authentication Server

A clean and modular Express.js server with JWT authentication, MongoDB integration, and Cloudinary image upload. Every functionality is organized in separate files for better maintainability.

## 🚀 Features

- **User Authentication**: Register, Login, Logout
- **JWT Tokens**: Access and Refresh token system
- **Password Security**: BCrypt hashing with salt rounds
- **Role-based Access**: Employee and Admin roles
- **Profile Image Upload**: Cloudinary integration with optimization
- **Input Validation**: Comprehensive validation with express-validator
- **Error Handling**: Centralized error handling
- **MongoDB Integration**: Mongoose ODM
- **Clean Architecture**: Modular file structure
- **CORS Support**: Cross-origin resource sharing
- **File Upload Security**: Size and type validation
- **Image Processing**: Auto resize, face detection, format optimization

## 📁 Project Structure

```
├── config/
│   ├── cloudinary.js        # Cloudinary configuration
│   └── database.js          # MongoDB connection
├── controllers/
│   ├── authController.js    # Authentication logic
│   └── userController.js    # User management logic
├── middleware/
│   ├── auth.js             # JWT authentication middleware
│   ├── errorHandler.js     # Global error handler
│   └── validation.js       # Validation handler
├── models/
│   └── User.js             # User model with employee/admin roles
├── routes/
│   ├── auth.js             # Authentication routes
│   └── user.js             # User management routes
├── utils/
│   ├── asyncHandler.js     # Async error handler
│   └── jwt.js              # JWT utilities
├── validations/
│   ├── authValidation.js   # Auth validation rules
│   └── userValidation.js   # User validation rules
├── .env.example            # Environment variables template
├── package.json            # Dependencies
└── server.js               # Application entry point
```

## 🛠️ Installation

1. **Clone and Install**

```bash
git clone <repository-url>
cd express-auth-server
npm install
```

2. **Environment Setup**

```bash
cp .env.example .env
```

3. **Configure Environment Variables**

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/auth_system

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRE=7d

# CORS Configuration
CORS_ORIGIN=http://localhost:3000

# Cloudinary Configuration (Required for profile image upload)
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

4. **Start MongoDB**

```bash
# Using MongoDB Community Server
mongod

# Or using Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

5. **Run the Server**

```bash
# Development
npm run dev

# Production
npm start
```

## 📚 API Endpoints

### Authentication Routes (`/api/auth`)

| Method | Endpoint    | Description              | Access  |
| ------ | ----------- | ------------------------ | ------- |
| POST   | `/register` | Register new user        | Public  |
| POST   | `/login`    | Login user               | Public  |
| POST   | `/refresh`  | Refresh access token     | Public  |
| POST   | `/logout`   | Logout user              | Private |
| GET    | `/me`       | Get current user profile | Private |

### User Routes (`/api/user`)

| Method | Endpoint                | Description          | Access  |
| ------ | ----------------------- | -------------------- | ------- |
| PUT    | `/profile`              | Update user profile  | Private |
| PUT    | `/change-password`      | Change password      | Private |
| POST   | `/upload-profile-image` | Upload profile image | Private |
| DELETE | `/profile-image`        | Delete profile image | Private |
| DELETE | `/account`              | Delete user account  | Private |
| GET    | `/all`                  | Get all users        | Admin   |
| GET    | `/:id`                  | Get user by ID       | Admin   |
| PUT    | `/:id/role`             | Update user role     | Admin   |
| DELETE | `/:id`                  | Delete user          | Admin   |

### Category Routes (`/api/category`)

| Method | Endpoint | Description               | Access          |
| ------ | -------- | ------------------------- | --------------- |
| POST   | `/`      | Create a new category     | Employee, Admin |
| GET    | `/`      | Get all active categories | Public          |
| GET    | `/:id`   | Get category by custom ID | Public          |
| PUT    | `/:id`   | Update a category         | Employee, Admin |
| DELETE | `/:id`   | Delete a category         | Admin           |

## 📋 API Endpoints Summary

### 🔓 Public Routes

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/refresh` - Refresh access token
- `GET /api/health` - Health check
- `GET /api/category` - Get all categories
- `GET /api/category/:id` - Get a single category

### 🔒 Private Routes (Employee)

- `GET /api/auth/me` - Get current user profile
- `POST /api/auth/logout` - Logout user
- `PUT /api/user/profile` - Update user profile
- `PUT /api/user/change-password` - Change password
- `POST /api/user/upload-profile-image` - Upload profile image
- `DELETE /api/user/profile-image` - Delete profile image
- `DELETE /api/user/account` - Delete user account
- `POST /api/category` - Create a category
- `PUT /api/category/:id` - Update a category

### 🛡️ Admin Only Routes

- `GET /api/user/all` - Get all users
- `GET /api/user/:id` - Get user by ID
- `PUT /api/user/:id/role` - Update user role
- `DELETE /api/user/:id` - Delete user
- `DELETE /api/category/:id` - Delete a category

## 🔐 User Roles

- **Employee** (Default): Standard user with basic access to profile management
- **Admin**: Full access to user management and admin routes

## 🖼️ Profile Image Features

- **Cloudinary Integration**: Images stored in cloud with CDN
- **Auto Optimization**: Resized to 400x400, face detection, quality optimization
- **Security**: File type validation (JPG, PNG, WebP), 5MB size limit
- **Smart Cleanup**: Old images automatically deleted when new ones uploaded
- **Error Handling**: Comprehensive error handling for upload failures

## 🔐 Authentication Flow

1. **Register/Login** → Receive access & refresh tokens
2. **API Requests** → Include `Authorization: Bearer <access_token>`
3. **Token Refresh** → Use refresh token when access token expires
4. **Logout** → Invalidate refresh token

## 📝 Request Examples

### Register User

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Your Name",
    "email": "Your Email",
    "password": "Your Password"
  }'
```

### Register Employee (Default)

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Your Name",
    "email": "Your Email",
    "password": "Your Password"
  }'
```

### Register Admin

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Your Name",
    "email": "Your Email",
    "password": "Your Password",
    "role": "admin"
  }'
```

### Login User

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "Your Email",
    "password": "Your Password"
  }'
```

### Access Protected Route

```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <your_access_token>"
```

### Upload Profile Image

```bash
curl -X POST http://localhost:3000/api/user/upload-profile-image \
  -H "Authorization: Bearer <your_access_token>" \
  -F "profileImage=@/path/to/your/image.jpg"
```

### Delete Profile Image

```bash
curl -X DELETE http://localhost:3000/api/user/profile-image \
  -H "Authorization: Bearer <your_access_token>"
```

### Update User Role (Admin Only)

```bash
curl -X PUT http://localhost:3000/api/user/:id/role \
  -H "Authorization: Bearer <admin_access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "admin"
  }'
```

### Create Category (Employee/Admin)

```bash
curl -X POST http://localhost:3000/api/category \
  -H "Authorization: Bearer <your_access_token>" \
  -F "name=Electronics" \
  -F "description=All kinds of electronic gadgets" \
  -F "image=@/path/to/your/image.jpg"
```

### Update Category (Employee/Admin)

```bash
curl -X PUT http://localhost:3000/api/category/SLS12345 \
  -H "Authorization: Bearer <your_access_token>" \
  -F "name=Modern Electronics" \
  -F "isActive=false"
```

### Delete Category (Admin Only)

```bash
curl -X DELETE http://localhost:3000/api/category/SLS12345 \
  -H "Authorization: Bearer <admin_access_token>"
```

## 🔒 Security Features

- **Password Hashing**: BCrypt with salt rounds (12)
- **JWT Security**: Signed tokens with expiration
- **Input Validation**: Comprehensive validation rules
- **Role-based Access Control**: Employee and Admin permissions
- **File Upload Security**: Size and type validation
- **Image Processing**: Automatic optimization via Cloudinary
- **CORS Protection**: Configurable origins
- **Error Handling**: No sensitive data exposure
- **Auto Cleanup**: Old images deleted to prevent storage bloat

## 🚦 Response Format

**Success Response:**

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {
    "user": {
      "id": "...",
      "name": "Your Name",
      "email": "Your Email",
      "role": "employee",
      "avatar": "https://res.cloudinary.com/your-cloud/image/upload/...",
      "createdAt": "...",
      "updatedAt": "..."
    },
    "tokens": {
      "accessToken": "...",
      "refreshToken": "...",
      "expiresIn": "7d"
    }
  }
}
```

**Profile Image Upload Success:**

```json
{
  "success": true,
  "message": "Profile image uploaded successfully",
  "data": {
    "user": { ... },
    "imageUrl": "https://res.cloudinary.com/your-cloud/image/upload/...",
    "publicId": "lifestyle/profile-images/profile_user123_1234567890"
  }
}
```

**Error Response:**

```json
{
  "success": false,
  "message": "Error description",
  "errors": [
    {
      "field": "email",
      "message": "Please provide a valid email address"
    }
  ]
}
```

## 🛠️ Development

### Adding New Routes

1. Create controller function in appropriate controller file
2. Add validation rules in validation folder
3. Define route in routes folder
4. Import and use in server.js

### Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment mode
- `MONGODB_URI`: MongoDB connection string
- `JWT_SECRET`: Secret key for JWT signing
- `JWT_EXPIRE`: Access token expiration time
- `CORS_ORIGIN`: Allowed CORS origins
- `CLOUDINARY_CLOUD_NAME`: Cloudinary cloud name
- `CLOUDINARY_API_KEY`: Cloudinary API key
- `CLOUDINARY_API_SECRET`: Cloudinary API secret

### Cloudinary Setup

1. Create account at [cloudinary.com](https://cloudinary.com)
2. Get your cloud name, API key, and API secret
3. Add credentials to `.env` file
4. Images will be stored in `lifestyle/profile-images/` folder

## 📦 Dependencies

- **express**: Web framework
- **mongoose**: MongoDB ODM
- **bcryptjs**: Password hashing
- **jsonwebtoken**: JWT implementation
- **express-validator**: Input validation
- **cors**: Cross-origin resource sharing
- **dotenv**: Environment variables
- **cloudinary**: Image hosting and optimization
- **multer**: File upload handling
- **multer-storage-cloudinary**: Cloudinary storage for Multer

## 🧪 Testing

### Postman Collection

### Quick Test Commands

```bash
# Register Employee
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Your Name","email":"Your Email","password":"Your Password"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"Your Email","password":"Your Password"}'

# Upload Profile Image (with token from login)
curl -X POST http://localhost:3000/api/user/upload-profile-image \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "profileImage=@image.jpg"
```

## 📋 JSON Test Data for Postman

### Employee Registration:

```json
{
  "name": "Your Name",
  "email": "Your Email",
  "password": "Your Password"
}
```

### Admin Registration:

```json
{
  "name": "Your Name",
  "email": "Your Email",
  "password": "Your Password",
  "role": "admin"
}
```

### Login Data:

```json
{
  "email": "Your Email",
  "password": "Your Password"
}
```

### Profile Update:

```json
{
  "name": "Your Updated Name",
  "email": "Your Updated Email"
}
```

### Password Change:

```json
{
  "currentPassword": "Your Current Password",
  "newPassword": "Your New Password",
  "confirmPassword": "Your New Password"
}
```

### Role Update (Admin only):

```json
{
  "role": "admin"
}
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License.
