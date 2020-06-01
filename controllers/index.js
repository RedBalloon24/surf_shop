const User = require('../models/user');
const Post = require('../models/post');
const passport = require('passport');
const mapBoxToken = process.env.MAPBOX_TOKEN;
const util = require('util');
const { cloudinary } = ('../cloudinary');
const { deleteProfileImage } = require('../middleware');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);


module.exports = {
    // GET /
    async landingPage(req, res, next) {
        const posts = await Post.find({});
        res.render('index', { posts, mapBoxToken, title: 'Bike Shop - Home' })
    },
    // GET /register
    getRegister(req, res, next) {
        res.render('register', { title: 'Register', username: '', email: '' });
    },
    // POST /register
    async postRegister(req, res, next) {
        try {
            if(req.file) {
                const { secure_url, public_id } = req.file;
                req.body.image = { secure_url, public_id }
            }
			const user = await User.register(new User(req.body), req.body.password);
			req.login(user, function(err) {
				if (err) return next(err);
				req.session.success = `Welcome to Bike Shop, ${user.username}!`;
				res.redirect('/');
			});
		} catch(err) {
            deleteProfileImage(req);
			const { username, email } = req.body;
            let error = err.message;
			if (error.includes('duplicate') && error.includes('index: email_1 dup key')) {
				error = 'A user with the given email is already registered';
            }
			res.render('register', { title: 'Register', username, email, error });
		}
    },
    // GET /login
    getLogin(req, res, next) {
        if(req.isAuthenticated()) return res.redirect('/');
        if(req.query.returnTo) req.session.redirectTo = req.headers.referer
        res.render('login', { title: 'Login' });
    },
    //POST /login
    async postLogin(req, res, next) {
        const { email, password} = req.body;
        const { user, error } = await User.authenticate()(email, password);
        if(!user && error) {
            console.log(error)
            return next(error)
        }
        req.login(user, function(err) {
            if(err) {
                console.log(err)
                return next(err);
            }
            req.session.success = `Welcome back, ${user.username}!`;
            const redirectUrl = req.session.redirectTo || '/';
            delete req.session.redirectTo;
            res.redirect(redirectUrl);
        });
    },
    //GET /logout
    getLogout(req, res, next) {
        req.logout();
        res.redirect('/');
    },
    //GET /profile
    async getProfile(req, res, next) {
        const posts = await Post.find().where('author').equals(req.user._id).limit(10).exec();
        res.render('profile', { posts });
    },
    //PUT /profile
    async updateProfile(req, res, next) {
        const { username, email } = req.body;
        const { currentUser } = res.locals;
        if(username) currentUser.username = username;
        if(email) currentUser.email = email;
        if(req.file) {
            if(currentUser.image.public_id) await cloudinary.v2.uploader.destroy(currentUser.image.public_id);
            const { secure_url, public_id } = req.file;
            currentUser.image = { secure_url, public_id }
        }

        await currentUser.save();
        
        const login = util.promisify(req.login.bind(req));
        await login(currentUser);
        req.session.success = 'Profile successfully updated!';
        res.redirect('/profile')
    },
    //GET /forgot-password
    getForgotPw(req, res, next) {
        res.render('users/forgot')
    },
    //PUT /forgot-password
    async putForgotPw(req, res, next) {
        const token = await crypto.randomBytes(20).toString('hex');
        const user = await User.findOne({ email: req.body.email });
        if(!user) {
            req.session.error = 'No account with that email address exists.'
            return res.redirect('/forgot-password');
        }
        user.resetPasswordToken = token;
        //expires in one hour
        user.resetPasswordExpires = Date.now() + 3600000; 
        await user.save();

        const message = {
            to: user.email,
            from: 'Bike Shop Admin <your@email.com>',
            subject: 'Bike Shop - Forgot Password  Reset',
            text: `You are receiving this because you (or someone else) 
            have requested the reset of the password for your account.
            Please click on the following link, or copy and paste it 
            into your browser to complete the process: 
            http://${req.headers.host}/reset/${token} 
            If you did not request this, please ignore this email and 
            your password will remain unchanged.`.replace(/            /g, ''),
            //html: '<strong>and easy to do anywhere, even with Node.js</strong>',
        };
        await sgMail.send(message);
        
        req.session.success = `An email has been sent to ${email} with further instructions.`
        res.redirect('/forgot-password')
    }
}