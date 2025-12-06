# ✅ Production Deployment Checklist

Use this checklist before deploying to production for the first time.

---

## 🔐 Security

- [ ] All secrets stored in AWS Secrets Manager (no hardcoded credentials)
- [ ] GitHub secrets configured for CI/CD
- [ ] Sentry DSN added to environment variables
- [ ] WorkOS credentials verified and working
- [ ] Database credentials rotated and secure
- [ ] CORS domains configured correctly
- [ ] API domain SSL certificate validated
- [ ] WAF rules reviewed and tested

---

## 🏗️ Infrastructure

- [ ] All CDK stacks deploy successfully
- [ ] CloudWatch Alarms created and tested
- [ ] SNS email subscription confirmed
- [ ] CloudWatch Dashboard accessible
- [ ] WAF Web ACL created and associated
- [ ] Lambda functions have correct memory/timeout
- [ ] S3 buckets have correct permissions
- [ ] Route53 DNS records pointing correctly

---

## 🧪 Testing

- [ ] All unit tests passing (`pnpm test:run`)
- [ ] Linter passing (`pnpm lint`)
- [ ] Type check passing (`pnpm typecheck`)
- [ ] Build succeeds (`pnpm build`)
- [ ] Smoke tests passing (`pnpm test:smoke`)
- [ ] Manual testing of critical endpoints
- [ ] Load testing completed (optional but recommended)

---

## 📊 Monitoring

- [ ] Sentry project created and configured
- [ ] Sentry receiving test events
- [ ] CloudWatch Alarms triggering correctly
- [ ] Dashboard showing metrics
- [ ] X-Ray tracing enabled and working
- [ ] Log retention policies set
- [ ] Error alerting configured (email/Slack/PagerDuty)

---

## 🚀 CI/CD

- [ ] GitHub Actions workflows created
- [ ] GitHub secrets configured
- [ ] GitHub environments set up (staging, production)
- [ ] Production environment requires approval
- [ ] Staging deploys automatically on `develop` push
- [ ] Production deploys on `main` push with approval
- [ ] Smoke tests run after deployment

---

## 🗄️ Database

- [ ] Database migrations tested
- [ ] Database connection pooling configured
- [ ] Database credentials in Secrets Manager
- [ ] Backup strategy documented
- [ ] Rollback procedure documented
- [ ] Database indexes optimized

---

## 🌐 Networking

- [ ] Custom domain configured
- [ ] SSL/TLS certificate valid
- [ ] DNS propagation complete
- [ ] CORS configured for all domains
- [ ] Rate limiting tested
- [ ] Geographic restrictions configured (if needed)

---

## 📝 Documentation

- [ ] README.md up to date
- [ ] SETUP_GUIDE.md reviewed
- [ ] API documentation generated
- [ ] Environment variables documented
- [ ] Deployment process documented
- [ ] Rollback procedure documented
- [ ] Troubleshooting guide available

---

## 💰 Cost Management

- [ ] AWS Budget alerts configured
- [ ] Cost Explorer enabled
- [ ] Lambda memory right-sized
- [ ] S3 lifecycle policies configured
- [ ] CloudWatch log retention optimized
- [ ] Authorizer caching enabled (5 min)

---

## 🔄 Rollback Plan

- [ ] Previous version tagged in Git
- [ ] Rollback procedure tested
- [ ] Database migration rollback tested
- [ ] CloudFormation rollback tested
- [ ] On-call rotation established

---

## 📞 Incident Response

- [ ] Runbook created
- [ ] On-call schedule defined
- [ ] Escalation path documented
- [ ] Communication plan established
- [ ] Post-mortem template ready

---

## ✅ Final Checks

- [ ] Staging environment fully tested
- [ ] Production environment variables verified
- [ ] All team members notified of deployment
- [ ] Maintenance window scheduled (if needed)
- [ ] Rollback plan reviewed
- [ ] Monitoring dashboard open and ready
- [ ] Sentry dashboard open and ready

---

## 🎉 Post-Deployment

- [ ] Smoke tests passed
- [ ] Health check endpoint responding
- [ ] Authenticated endpoints working
- [ ] CloudWatch metrics flowing
- [ ] Sentry receiving events
- [ ] No alarms triggered
- [ ] Performance within expected range
- [ ] Team notified of successful deployment

---

## 📋 Deployment Command

```bash
# Staging
git push origin develop

# Production (requires approval)
git push origin main
```

---

## 🆘 Emergency Contacts

- **AWS Console**: https://console.aws.amazon.com
- **Sentry Dashboard**: https://sentry.io
- **GitHub Actions**: https://github.com/YOUR_ORG/YOUR_REPO/actions
- **CloudWatch**: https://console.aws.amazon.com/cloudwatch
- **On-Call**: [Add contact info]

---

## 📝 Notes

Add any deployment-specific notes here:

- 
- 
- 

---

**Deployment Date**: _______________
**Deployed By**: _______________
**Version/Commit**: _______________
**Sign-off**: _______________
