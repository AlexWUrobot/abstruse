import { Observable, Observer } from 'rxjs';
import { dockerExec } from '../docker';
import { CommandType } from '../config';
import { findFromEnvVariables } from '../deploy';
import * as style from 'ansi-styles';
import chalk from 'chalk';

export function elasticDeploy(
  preferences: any, container: string, variables: string[]
): Observable<any> {
  return new Observable((observer: Observer<any>) => {
    // 1. check preferences
    const application = preferences.application;
    let accessKeyId = findFromEnvVariables(variables, 'accessKeyId');
    let secretAccessKey = findFromEnvVariables(variables, 'secretAccessKey');
    let region = findFromEnvVariables(variables, 'region');
    let version = findFromEnvVariables(variables, 'version');
    let description = preferences.description;
    let s3Bucket = preferences.s3Bucket;
    let codeCommit = preferences.codeCommit;
    let applicationType = preferences.applicationType;
    let environmentName = preferences.environmentName;
    let solutionStackName = preferences.solutionStackName;
    let environmentTemplate = preferences.environmentTemplate;
    let errors = false;

    if (!application) {
      const msg = chalk.red('application is not set in yml config file \r\n');
      observer.next({ type: 'data', data: msg});
      errors = true;
    }

    if (!environmentName) {
      const msg = chalk.red('environmentName is not set in yml config file \r\n');
      observer.next({ type: 'data', data: msg});
      errors = true;
    }

    if (!accessKeyId) {
      if (preferences && preferences.accessKeyId) {
        accessKeyId = preferences.accessKeyId;
      } else {
        const msg = chalk.red('accessKeyId is not set in environment '
          + 'variables or in yml config \r\n');
        observer.next({ type: 'data', data: msg});
        errors = true;
      }
    }

    if (!secretAccessKey) {
      if (preferences && preferences.secretAccessKey) {
        secretAccessKey = preferences.secretAccessKey;
      } else {
        const msg = chalk.red('secretAccessKey is not set in environment variables or'
          + ' in yml config \r\n');
        observer.next({ type: 'data', data: msg});
        errors = true;
      }
    }

    if (!region) {
      if (preferences && preferences.region) {
        region = preferences.region;
      } else {
        const msg =
          chalk.red('region is not set in environment variables or in yml config file \r\n');
        observer.next({ type: 'data', data: msg});
        errors = true;
      }
    }

    let sourceRepository;
    let sourceLocation;
    if (s3Bucket && codeCommit) {
      const msg = chalk.red('Specify a source bundle in S3 bucket or a commit in an AWS CodeCommit'
        + 'repository, but not both. \r\n');
      observer.next({ type: 'data', data: msg});
      errors = true;
    } else if (s3Bucket) {
      sourceRepository = 'S3';
      sourceLocation = s3Bucket;
    } else if (codeCommit) {
      sourceRepository = 'CodeCommit';
      sourceLocation = codeCommit;
    }

    if (!errors) {
      if (!version) {
        const date = (new Date()).toLocaleDateString();
        version = `abstruse_${date}`;
      }

      if (!description) {
        description = 'Deployed with Abstruse.';
      }

      if (!applicationType) {
        applicationType = 'zip';
      }

      let msg = style.yellow.open + style.bold.open + '==> deploy started' +
      style.bold.close + style.yellow.close + '\r\n';
      observer.next({ type: 'data', data: msg });

      // 2. set credentials for awscli
      let command = {
        type: CommandType.deploy, command: `aws configure set aws_access_key_id ${accessKeyId}`
      };
      dockerExec(container, command)
        .toPromise()
        .then(result => {
          if (!(result && result.data === 0)) {
            const msg = 'aws configure aws_access_key_id failed';
            observer.next({ type: 'containerError', data: msg});
            return Promise.reject(1);
          }

          let command = {
            type: CommandType.deploy,
            command: `aws configure set aws_secret_access_key ${secretAccessKey}`
          };

          return dockerExec(container, command).toPromise();
        })
        .then(result => {
          if (!(result && result.data === 0)) {
            const msg = 'aws configure aws_secret_access_key failed';
            observer.next({ type: 'containerError', data: msg});
            return Promise.reject(1);
          }

          let command = {
            type: CommandType.deploy, command: `aws configure set region ${region}`
          };

          return dockerExec(container, command).toPromise();
        })
        .then(result => {
          if (!(result && result.data === 0)) {
            const msg = 'aws configure region failed';
            observer.next({ type: 'containerError', data: msg});
            return Promise.reject(1);
          }

          // 3. create-application-version
          let command;
          if (s3Bucket || codeCommit) {
            command = {
              type: CommandType.deploy, command: `aws elasticbeanstalk create-application-version`
                + ` --application-name "${application}" --version-label "${version}"`
                + ` --description "${description}" --source-build-information`
                + ` SourceType="${applicationType}", SourceRepository="${sourceRepository}",`
                + ` SourceLocation="${sourceLocation}" --auto-create-application`
            };
          } else {
            command = {
              type: CommandType.deploy, command: `aws elasticbeanstalk create-application-version`
                + ` --application-name "${application}" --version-label "${version}"`
                + ` --description "${description}" --auto-create-application`
            };
          }

          return dockerExec(container, command).toPromise();
        })
        .then(() => {
          // 3. check if environment exists
          return environmentExists(container, environmentName);
        })
        .then(exists => {
          if (exists) {
            // 4. create-environment
            if (environmentTemplate) {
              let command = {
                type: CommandType.deploy, command: `aws elasticbeanstalk create-environment`
                  + ` --application-name "${application}" --environment-name "${environmentName}"`
                  + ` --template-name "${environmentTemplate}"`
              };

              return dockerExec(container, command)
                .toPromise()
                .then(result => {
                  if (!(result && result.data === 0)) {
                    const msg = 'aws create environment failed';
                    observer.next({ type: 'containerError', data: msg});
                    return Promise.reject(1);
                  }

                  return Promise.resolve();
                });
            } else if (solutionStackName) {
              let command = {
                type: CommandType.deploy, command: `aws elasticbeanstalk create-environment`
                  + ` --application-name "${application}" --environment-name "${environmentName}"`
                  + ` --solution-stack-name "${solutionStackName}"`
              };

              return dockerExec(container, command)
                .toPromise()
                .then(result => {
                  if (!(result && result.data === 0)) {
                    const msg = 'aws create environment failed';
                    observer.next({ type: 'containerError', data: msg});
                    return Promise.reject(1);
                  }

                  return Promise.resolve();
                });
            }

            const msg = `Environment with name ${environmentName} doesn't exists, environment `
              + `template-name or solution-stack-name has to be provided in deploy configuration`
              + ` to successfully create new environment`;
            observer.next({ type: 'containerError', data: msg});
            return Promise.reject(1);
          } else {
            return Promise.resolve();
          }
        })
        .then(() => {
          let msg = style.yellow.open + style.bold.open + '==> deployment completed successfully!'
            + style.bold.close + style.yellow.close + '\r\n';
          observer.next({ type: 'data', data: msg });
          observer.complete();
        })
        .catch(err => {
          observer.error(err);
          observer.complete();
        });
    } else {
      observer.error(1);
      observer.complete();
    }
  });
}

function environmentExists(container, environment): Promise<any> {
  return new Promise((resolve, reject) => {
    const getEnvCommand = `aws elasticbeanstalk describe-environments --environment-names`
      + ` "${environment}"`;
    let envExists = false;
    dockerExec(container, { type: CommandType.deploy, command: getEnvCommand })
    .subscribe(event => {
      if (event && event.data) {
        if (String(event.data).indexOf(environment) != -1) {
          envExists = true;
        }
      }
    },
    err => reject(err),
    () => resolve(envExists));
  });
}
